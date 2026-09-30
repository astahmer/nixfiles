# Plugin Finder

Search BB's plugin catalog and add compatible plugins without leaving the BB app.

## What it does

- Searches catalog names and descriptions as you type.
- Shows publisher, marketplace, compatibility, and install status.
- Shows the resolved source before installation; third-party marketplace entries
  are labeled as unreviewed by BB.
- Adds the selected plugin through BB's catalog install API after confirmation.

The **Add plugins** page appears in the sidebar after installation. Search and
catalog operations use the BB host SDK; this plugin does not fetch catalog data
or install packages itself.

## Develop

```sh
npm install
bb plugin types
bb plugin build
```

To install this checkout into the local BB app:

```sh
bb plugin install .
```
