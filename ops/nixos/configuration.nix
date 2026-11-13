# Shared configuration for the agent box: a locked-down base (Tailscale only,
# SSH keys, memory and CPU limits) for Claude Code and Cursor CLI, which the
# agent user installs and runs from its own home. See ops/nixos/README.md and
# ops/agent-home/.
{ config, lib, pkgs, ... }:

let
  cfg = config.agentBox;
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
      # One build at a time on one core, so a rebuild never starves the agents.
      max-jobs = 1;
      cores = 1;
    };
    nix.daemonCPUSchedPolicy = "batch";
    nix.daemonIOSchedClass = "idle";
    nix.gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 14d";
    };

    # ---- users --------------------------------------------------------------
    # Mutable users: root keeps the password Hostinger set (console recovery);
    # SSH password logins are off below regardless.
    users.users.root.openssh.authorizedKeys.keys = cfg.authorizedKeys;

    # Runs Claude Code and Cursor CLI, installed in its own ~/.local (see
    # ops/agent-home). No sudo on purpose: it can change its home, not the base.
    users.users.agent = {
      isNormalUser = true;
      description = "Claude Code + Cursor CLI";
      openssh.authorizedKeys.keys = cfg.authorizedKeys;
      uid = 1000;
      # Keep agent's systemd user manager running without a login, so its user
      # services (Remote Control) start at boot and outlive SSH sessions.
      linger = true;
    };

    # ---- memory and cpu -----------------------------------------------------
    # 2 vCPU / 7.8 GB. Everything agent runs (SSH and Tailscale SSH logins,
    # its user services) lives in user-1000.slice; capping that slice keeps
    # about 1.8 GB for sshd, tailscaled and the rest, so the box stays reachable.
    systemd.slices."user-1000" = {
      overrideStrategy = "asDropin";
      sliceConfig = {
        MemoryHigh = "5G"; # throttled and reclaimed above this
        MemoryMax = "6G"; # hard cap
        MemorySwapMax = "2G"; # zram is RAM too
        TasksMax = 4096;
      };
    };

    # Compressed swap in RAM: memory pressure slows things down instead of
    # killing them straight away.
    zramSwap = {
      enable = true;
      algorithm = "zstd";
      memoryPercent = 50;
    };

    # Under sustained pressure, oomd kills the heaviest process group in the
    # user slice (an agent's runaway test run) before the kernel picks at random.
    systemd.oomd = {
      enable = true;
      enableUserSlices = true;
    };

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

    # ---- tools for the agents -----------------------------------------------
    environment.systemPackages = with pkgs; [
      nodejs_22
      git
      git-lfs
      gh
      jq
      ripgrep
      tmux
      curl
      util-linux # script(1), for running TUIs as services
      # Compilers for npm packages without prebuilt binaries (node-gyp).
      gcc
      gnumake
      python3
    ];
    # Claude Code and Cursor CLI install themselves here (and self-update).
    environment.localBinInPath = true;

    programs.git = {
      enable = true;
      lfs.enable = true;
    };

    # Prebuilt binaries (Claude Code, Cursor CLI, Node native modules, Chromium)
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
