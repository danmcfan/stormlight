# Settings that belong to this one machine. Edit before the first rebuild.
{ lib, ... }:
{
  # Copy from the template's own configuration. Check with:
  #   cat /etc/nixos/configuration.nix; nixos-version
  # Never change it afterwards (it is not the NixOS release you run).
  system.stateVersion = "REPLACE_ME"; # e.g. "26.05"

  # SSH public keys allowed to log in as `agent` and `root` (public SSH, and
  # plain-sshd over the tailnet). Without at least one the build refuses to
  # evaluate, because password logins are off and you would lock yourself out.
  agentBox.authorizedKeys = [
    # "ssh-ed25519 AAAA... you@laptop"
  ];

  # ---- Boot loader and disk: keep what the Hostinger template uses ---------
  # Copy the template's boot.loader.* / fileSystems / networking lines here if
  # /etc/nixos/configuration.nix has them. Reported for Hostinger's image (verify
  # with `lsblk` and `[ -d /sys/firmware/efi ] && echo uefi || echo bios`):
  # BIOS boot, GRUB on /dev/sda. Uncomment only if that matches your box:
  #
  # boot.loader.grub.enable = true;
  # boot.loader.grub.device = "/dev/sda";

  # Hostinger's image gets its static IP from cloud-init (rendered into
  # /etc/systemd/network). Keep cloud-init enabled or the box loses its network
  # on the next switch. If the template's configuration.nix says otherwise,
  # follow it instead. First apply with `nixos-rebuild test` (README step 6).
  services.cloud-init = {
    enable = true;
    network.enable = true; # renders the static IP into systemd-networkd
  };
  networking.useNetworkd = true;
  networking.useDHCP = false;
}
