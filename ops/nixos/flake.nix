{
  description = "agent-box: NixOS host for Claude Code agents + the swarm dashboard (tailnet only)";

  # Current stable NixOS (26.05 when this was written; Hostinger's template is
  # the same release). To move to a new release, change this one line, run
  # `nix flake update`, and rebuild.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }: {
    nixosConfigurations.agent-box = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./hardware-configuration.nix # replace with the box's own (README step 4)
        ./host.nix                   # the box's own boot/keys/stateVersion
        ./configuration.nix          # everything shared
      ];
    };
  };
}
