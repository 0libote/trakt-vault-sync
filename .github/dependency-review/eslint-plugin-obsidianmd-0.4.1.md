# eslint-plugin-obsidianmd 0.4.1 review

The stricter `no-unsupported-api` rule identified five uses of `ButtonComponent.setDestructive()`, which requires Obsidian 1.13 while this plugin supports Obsidian 1.8.7.

The reviewed migration preserves the existing confirmation dialogs and replaces only the button styling call with the older supported `setWarning()` API. Release verification requires a frozen lockfile install, high-severity audit, smoke tests, lint, and production build.

The isolated compatibility artifact passed all five release gates before application.
