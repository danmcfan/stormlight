# Settings that belong to this one machine (Hostinger KVM, NixOS 26.05 template).
# Values below mirror the template's /etc/nixos/configuration.nix as shipped.
{ lib, pkgs, ... }:
{
  # From the template. Never change it afterwards (it is not the release you run).
  system.stateVersion = "26.05";

  # SSH only over Tailscale. Verified `ssh agent@agent-box` over the tailnet first.
  agentBox.publicSsh = false;

  # SSH public keys allowed to log in as `agent` and `root`.
  agentBox.authorizedKeys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJk74y4vUcpM2sqWbMQffZhkt8bHgqxljVQ+6SpGTTZb danmcfan33@gmail.com"
  ];

  # ---- Boot loader and disk (template: SeaBIOS, MBR, GRUB on /dev/sda) -------
  boot.loader.grub.enable = true;
  boot.loader.grub.device = "/dev/sda";
  boot.loader.grub.efiSupport = false;
  boot.loader.timeout = 1;

  # Template grows the root partition and filesystem when the plan's disk grows.
  # (The device itself comes from hardware-configuration.nix.)
  fileSystems."/".autoResize = true;
  boot.growPartition = true;

  # Serial console for Proxmox serial0 + memory hotplug, as in the template.
  boot.kernelParams = [
    "console=tty0" "console=ttyS0,115200" "earlyprintk=ttyS0,115200"
    "consoleblank=0" "memhp_default_state=online"
  ];

  # ---- Hostinger provisioning (hPanel talks to the VM through these) ---------
  services.qemuGuest.enable = true;
  # hVPS runs bare-name commands (sh, cloud-init, chpasswd, dig, ...) through the
  # guest agent, so give it the full system PATH, as the template does.
  systemd.services.qemu-guest-agent.environment.PATH =
    lib.mkForce "/run/wrappers/bin:/run/current-system/sw/bin:/bin";
  environment.systemPackages = with pkgs; [
    cloud-init
    dnsutils # dig, nslookup, host
    nettools # ifconfig, netstat, route
    wget
    nano
  ];

  # ---- Network: cloud-init renders the static IP into systemd-networkd -------
  # (/etc/systemd/network/10-cloud-init-eth0.network). Keep it, or the box loses
  # its network on switch.
  services.cloud-init = {
    enable = true;
    network.enable = true;
    settings.datasource_list = [ "NoCloud" "ConfigDrive" ];
    # Its helper isn't shipped in NixOS's cloud-init; avoids a "degraded" exit.
    settings.ssh.emit_keys_to_console = false;
  };
  networking.useNetworkd = true;
  networking.useDHCP = lib.mkForce false;
}
