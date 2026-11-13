# PLACEHOLDER. Replace this file with the one generated on the box:
#
#   cp /etc/nixos/hardware-configuration.nix ./hardware-configuration.nix
#   # if /etc/nixos is empty (Hostinger's image can ship it empty):
#   nixos-generate-config --show-hardware-config > ./hardware-configuration.nix
#
# It holds this machine's disk labels/UUIDs and kernel modules, which cannot be
# guessed. Until it is replaced, evaluation stops with the assertion in
# configuration.nix, so a build can never go out with a made-up disk layout.
{ ... }:
{
  agentBox.placeholders.hardware = true;
}
