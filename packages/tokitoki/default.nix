{ stdenvNoCC, tokitokiSource }:

# Keep the package exposed from this flake while delegating the reproducible
# source build and Bun dependency hash to Tokitoki's own flake. This avoids a
# machine-local compiled binary and keeps updates pinned in flake.lock.
tokitokiSource.packages.${stdenvNoCC.hostPlatform.system}.default
