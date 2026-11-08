# Non-24 Clock

A digital clock desklet for Cinnamon (Linux Mint) that runs on a day length of your choosing, made for people with a non-24-hour sleep-wake rhythm.

## Features

- Adjustable day length, down to fractions of a second. Enter decimal hours (`24.5`), `24:30` or `24:30.5`, or `24:39:35.244`
- Two display modes:
  - **Mars-style**: the day is always shown as 0-24, so the hours are stretched or compressed
  - **Wrap-around**: normal-length hours that wrap at your day length, so the display can go above 24 (e.g. 24:17 on a 24 h 30 min day)
- Set the current Non-24 time by typing it in; switching mode never moves Non-24 midnight
- Optional day counter and a second line with the local Earth time
- DSEG7 / DSEG14 segment fonts (or any installed font), with unlit segments, colors, size and digit-shape options

## Install

1. Install the DSEG fonts (see below).
2. Copy the `non24clock@ragnar` folder to `~/.local/share/cinnamon/desklets/`.
3. Right-click the desktop, choose *Add Desklets*, and add **Non-24 Clock**.

If the desklet does not show up right away, restart Cinnamon (Ctrl+Alt+Esc).

## Fonts

The desklet uses the [DSEG](https://github.com/keshikan/DSEG) fonts by Keshikan, but does **not** bundle them. On Linux Mint / Debian / Ubuntu:

```
sudo apt install fonts-dseg
```

The digit-shape options need DSEG v0.50 or newer; with older versions the standard digits are shown. Any other installed font can be entered under *Custom font family*.

## License

The desklet code is released under the [MIT License](LICENSE).

DSEG is not part of this repository and is licensed separately by its author under the SIL Open Font License 1.1. If you redistribute the font together with this desklet, include its license and follow its terms.
