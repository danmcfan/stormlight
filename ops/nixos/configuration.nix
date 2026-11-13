# Shared configuration for the agent box: Claude Code + agents + the swarm
# dashboard, reachable only over Tailscale. See ops/nixos/README.md.
#
# Defaults you can change: hostname `agent-box`, users `agent` and `deploy`,
# deploy checkout /srv/swarm, dashboard on 127.0.0.1:3000.
{ config, lib, pkgs, ... }:

let
  cfg = config.agentBox;
  swarmPort = 3000;
  sw = "/run/current-system/sw/bin";
in
{
  options.agentBox = {
    publicSsh = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Open the SSH port on the public interface. Leave true until
        `tailscale ssh agent@agent-box` works from your laptop, then set false
        and rebuild. (Everything arriving on tailscale0 is trusted regardless.)
      '';
    };

    authorizedKeys = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "SSH public keys for the agent and root users (set in host.nix).";
    };

    tailscaleAuthKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = "/etc/tailscale/authkey";
      description = ''
        File holding a Tailscale auth key (tagged tag:agent-box). It lives only
        on the box, never in this repo or the Nix store. Used once, when the box
        is not yet logged in. Set to null to log in by hand with
        `tailscale up --ssh --advertise-tags tag:agent-box`.
      '';
    };

    flakeDir = lib.mkOption {
      type = lib.types.str;
      default = "/root/stormlight/ops/nixos";
      description = "Where root's checkout of this flake lives (used only by autoUpgrade).";
    };

    autoUpgrade = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Nightly `nixos-rebuild switch` from flakeDir after bumping nixpkgs within
        the release channel (security and bug-fix updates). Off by default: a
        silent rebuild can change what the agents see. It never reboots.
      '';
    };

    swarmDev = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Run the swarm dashboard in dev mode (Vite, hot reload) from the agent's
          own checkout, ~agent/stormlight/swarm, with the lead agent's prompt box.
          Reached at http://agent-box.<tailnet>.ts.net:<port>; it binds only to
          the tailnet address, so it is never on the public interface.
        '';
      };
      tailnetIp = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "The box's Tailscale IPv4 (`tailscale ip -4`); the dev server binds to it.";
      };
      port = lib.mkOption {
        type = lib.types.port;
        default = 5173;
      };
    };

    # Set by the placeholder hardware-configuration.nix only.
    placeholders.hardware = lib.mkOption {
      type = lib.types.bool;
      default = false;
      internal = true;
    };
  };

  config = {
    assertions = [
      {
        assertion = !cfg.placeholders.hardware;
        message = "ops/nixos/hardware-configuration.nix is still the placeholder: copy the box's own (README step 4).";
      }
      {
        assertion = config.system.stateVersion != "REPLACE_ME";
        message = "Set system.stateVersion in ops/nixos/host.nix to the template's value.";
      }
      {
        assertion = !cfg.swarmDev.enable || cfg.swarmDev.tailnetIp != null;
        message = "Set agentBox.swarmDev.tailnetIp in host.nix (`tailscale ip -4` on the box).";
      }
      {
        assertion = cfg.authorizedKeys != [ ];
        message = "Add your SSH public key to agentBox.authorizedKeys in host.nix; password logins are off, so an empty list locks you out.";
      }
    ];

    # ---- basics -------------------------------------------------------------
    networking.hostName = "agent-box";
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";

    nix.settings = {
      experimental-features = [ "nix-command" "flakes" ];
      auto-optimise-store = true;
    };
    nix.gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 14d";
    };

    # claude-code is unfree in nixpkgs; allow just that one.
    nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "claude-code" ];

    # ---- users --------------------------------------------------------------
    # Mutable users: root keeps the password Hostinger set (console recovery);
    # SSH password logins are off below regardless.
    users.users.root.openssh.authorizedKeys.keys = cfg.authorizedKeys;

    # Runs Claude Code, the agents and the dashboard. No sudo on purpose.
    users.users.agent = {
      isNormalUser = true;
      description = "Claude Code + agents + dashboard";
      openssh.authorizedKeys.keys = cfg.authorizedKeys;
      uid = 1000;
      # Keep agent's systemd user manager running without a login: each lead
      # run is a transient user unit (systemd-run --user), so it survives
      # dashboard restarts.
      linger = true;
    };

    # CI only (over Tailscale SSH, which needs no key). Sudo rights below.
    users.users.deploy = {
      isNormalUser = true;
      description = "CI deploys of the swarm dashboard";
    };

    security.sudo.extraRules = [
      {
        users = [ "deploy" ];
        commands = [
          { command = "${sw}/systemctl restart swarm"; options = [ "NOPASSWD" ]; }
          { command = "${sw}/journalctl -u swarm -n 40 --no-pager"; options = [ "NOPASSWD" ]; }
        ];
      }
    ];

    # ---- ssh + firewall -----------------------------------------------------
    services.openssh = {
      enable = true;
      openFirewall = false; # decided below by agentBox.publicSsh
      settings = {
        PasswordAuthentication = false;
        KbdInteractiveAuthentication = false;
        PermitRootLogin = "prohibit-password";
      };
    };

    networking.firewall = {
      enable = true;
      trustedInterfaces = [ "tailscale0" ];
      allowedUDPPorts = [ config.services.tailscale.port ]; # direct WireGuard
      allowedTCPPorts = lib.optionals cfg.publicSsh config.services.openssh.ports;
      checkReversePath = "loose"; # recommended with Tailscale
    };

    # ---- tailscale ----------------------------------------------------------
    services.tailscale = {
      enable = true;
      useRoutingFeatures = "none"; # not a subnet router or exit node
      authKeyFile = cfg.tailscaleAuthKeyFile;
      extraUpFlags = [ "--ssh" "--hostname=agent-box" "--advertise-tags=tag:agent-box" ];
    };

    # Tailnet-only HTTPS for the dashboard. Never `funnel`: transcripts hold code
    # and command output and the app has no auth. (services.tailscale.serve is
    # for Tailscale Services (svc:), a different feature, so this is a plain
    # oneshot.) `serve --bg` persists in tailscaled; this reasserts it at boot
    # and retries until the box is logged in and HTTPS certs are enabled.
    systemd.services.swarm-tailscale-serve = {
      description = "Publish the swarm dashboard on the tailnet (tailscale serve)";
      after = [ "tailscaled.service" "tailscaled-autoconnect.service" ];
      wants = [ "tailscaled.service" ];
      wantedBy = [ "multi-user.target" ];
      path = [ config.services.tailscale.package ];
      script = "tailscale serve --bg --https=443 http://127.0.0.1:${toString swarmPort}";
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        TimeoutStartSec = 90;
        Restart = "on-failure";
        RestartSec = 30;
      };
    };

    # ---- the swarm dashboard ------------------------------------------------
    # Code comes from the deploy checkout (CI runs ops/vps/update-swarm.sh); only
    # the unit is declared here. The unit is skipped until the checkout is built.
    systemd.tmpfiles.rules = [
      "d /srv/swarm 0755 deploy deploy -" # deploy writes; agent reads (world-readable)
    ];

    systemd.services.swarm = {
      description = "Swarm dashboard (tailnet-only, behind tailscale serve)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = "/srv/swarm/swarm/server.mjs";
      environment = {
        NODE_ENV = "production";
        HOST = "127.0.0.1";
        PORT = toString swarmPort;
        SWARM_TRANSCRIPTS_DIR = "/home/agent/.claude/projects";
      };
      serviceConfig = {
        User = "agent";
        WorkingDirectory = "/srv/swarm/swarm";
        ExecStart = "${pkgs.nodejs_22}/bin/node server.mjs";
        Restart = "on-failure";
        RestartSec = 3;
        # Reads ~/.claude (transcripts, plan-usage, queue) and the checkout only.
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = "read-only";
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        LockPersonality = true;
      };
    };

    # ---- the swarm dashboard, dev mode (hot reload + lead agent) ----------------
    # Runs from the agent's checkout so edits (yours or the agents') reload live.
    # The lead agent it hosts spawns `claude` as `agent`, so Claude Code must be
    # logged in once as that user.
    systemd.services.swarm-dev = lib.mkIf cfg.swarmDev.enable {
      description = "Swarm dashboard, dev mode (tailnet-only, hot reload, lead agent)";
      after = [ "network-online.target" "tailscaled.service" "user@1000.service" ];
      wants = [ "network-online.target" "tailscaled.service" "user@1000.service" ];
      wantedBy = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = "/home/agent/stormlight/swarm/node_modules/.bin/vite";
      path = with pkgs; [ nodejs_22 claude-code git git-lfs gh ripgrep bash coreutils findutils gnugrep gnused jq config.systemd.package ];
      environment = {
        HOME = "/home/agent";
        SWARM_TRANSCRIPTS_DIR = "/home/agent/.claude/projects";
        SWARM_LEAD_CWD = "/home/agent/stormlight";
        # Run each lead prompt as its own user unit, outside this service's
        # cgroup, so restarting the dashboard never kills the lead.
        SWARM_LEAD_DETACH = "systemd";
        XDG_RUNTIME_DIR = "/run/user/1000";
        DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/1000/bus";
      };
      serviceConfig = {
        User = "agent";
        Group = "users";
        WorkingDirectory = "/home/agent/stormlight/swarm";
        ExecStart = "/home/agent/stormlight/swarm/node_modules/.bin/vite dev --host ${cfg.swarmDev.tailnetIp} --port ${toString cfg.swarmDev.port} --strictPort";
        # Fails until tailscaled has brought the tailnet address up; keep retrying.
        Restart = "always";
        RestartSec = 5;
        NoNewPrivileges = true;
        PrivateTmp = true;
      };
    };

    # ---- tools for the agents -----------------------------------------------
    environment.systemPackages = with pkgs; [
      nodejs_22
      git
      git-lfs
      gh
      jq
      ripgrep
      claude-code # unfree, allowed above; nixpkgs may trail the newest release
      tmux
      curl
      # Compilers for npm packages without prebuilt binaries (node-gyp).
      gcc
      gnumake
      python3
    ];
    programs.git = {
      enable = true;
      lfs.enable = true;
    };

    # Prebuilt binaries (Node native modules, Playwright's downloaded Chromium)
    # expect a normal Linux loader and libraries; nix-ld provides them. The
    # defaults (zlib, openssl, libstdc++, ...) stay; these are added for Chromium.
    programs.nix-ld = {
      enable = true;
      libraries = with pkgs; [
        glib nss nspr atk at-spi2-atk cups dbus libdrm libxkbcommon libgbm
        alsa-lib pango cairo expat fontconfig freetype
        libx11 libxcomposite libxdamage libxext libxfixes libxrandr libxcb
      ];
    };
    fonts.packages = with pkgs; [ dejavu_fonts liberation_ttf ]; # screenshot text

    # ---- upgrades (optional, off by default) --------------------------------
    system.autoUpgrade = lib.mkIf cfg.autoUpgrade {
      enable = true;
      flake = "${cfg.flakeDir}#agent-box";
      flags = [ "--update-input" "nixpkgs" ];
      dates = "04:40";
      randomizedDelaySec = "30min";
      allowReboot = false;
    };
  };
}
