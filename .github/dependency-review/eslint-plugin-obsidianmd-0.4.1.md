# eslint-plugin-obsidianmd 0.4.1 review

The stricter `no-unsupported-api` rule identified five existing uses of `ButtonComponent.setDestructive()`. That API requires Obsidian 1.13, while release metadata incorrectly advertised support from Obsidian 1.8.7.

The release metadata now declares Obsidian 1.13.0 as the minimum supported version for 1.0.2. This prevents older clients from installing a build that can call an unavailable API. Existing confirmation dialogs remain unchanged.

Release verification requires a frozen lockfile install, high-severity audit, smoke tests, strict lint, and production build.
