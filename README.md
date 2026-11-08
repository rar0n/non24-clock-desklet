# Non-24 Clock

A simple clock desklet for Cinnamon (Linux Mint) with adjustable day length for Non-24 people (Non-24-hour sleep-wake rhythm disorder, or so they call it. I call it normal).

The app is entirely "vibe coded" with Claude 5.5 (medium effort).


## Features

- Adjustable day length, down to fractions of a second. Enter decimal hours (`24.5`), `24:30` or `24:30.5`, or `24:39:35.244`
- For fun: Day-length presets for the planets of your local solar system, the Moon, Pluto and a mysterious Planet X (solar day, sunrise to sunrise; see [Planet day lengths](#planet-day-lengths)). The hour field grows with the day length, so Mercury reads `0000:00:00` to `4222:32:09`
- Two display modes:
  - **Mars-style**: the day is always shown as 0-24, so the hours are stretched or compressed
  - **Wrap-around**: normal-length hours that wrap at your Non-24 day length. The display can go above 24 (e.g. 24:17 on a 24 h 30 min day)
- Set the current Non-24 time by typing it in, or with one button set it to the current local time (wrap-around mode needs a day length longer than the local time); switching mode never moves Non-24 midnight
- Note setting day length or selecting from planet list have a ~3 second delay (a Cinnamon Desklet feature, apparently).
- Optional second line with the local Earth time, or a day counter.
- DSEG7 / DSEG14 segment fonts (or any installed font), with unlit segments, colors, size and digit-shape options

## Planet day lengths

- Mostly included for fun

The presets are the mean *solar* day (noon to noon), not the rotation period. It is calculated as `1 / |1/rotation - 1/orbit|` from the sidereal rotation period and the sidereal orbital period; Venus and Uranus rotate retrograde, which makes their solar day shorter than their rotation. Earth is exactly 24 h and Mars is the official sol; the calculation reproduces the Mars sol to within half a millisecond.

| Planet | Solar day | Rotation (sidereal) used |
| --- | --- | --- |
| Mercury | 4222:32:09.4 (175.939 d) | 58.646225 d (IAU rate 6.1385025 deg/day) |
| Venus | 2802:00:40.9 (116.750 d) | 243.018484 d retrograde (IAU rate -1.4813688 deg/day) |
| Earth | 24:00:00 | by definition |
| Moon | 708:44:02.88 (29.530588853 d) | synchronous: sidereal 27.321661 d; the solar day is the synodic month (new moon to new moon) |
| Mars | 24:39:35.244 | 24:37:22.664 (IAU rate 350.89198226 deg/day) |
| Jupiter | 9:55:33.12 | 9:55:29.711, System III (1965) |
| Saturn | 10:39:23.98 | 10:39:22.4, IAU rate 810.7939024 deg/day (Voyager radio) |
| Uranus | 17:14:22.55 | 17:14:24.0 retrograde (IAU rate -501.1600928 deg/day) |
| Neptune | 15:57:59.32 | 15:57:58.68, IAU rate 541.1397757 deg/day (Karkoschka 2011) |
| Pluto | 153:16:57.14 (6.3868 d) | 153:17:36.07 retrograde (IAU rate 56.3625225 deg/day); a dwarf planet, not a planet |
| Planet X | 25:15:00 | placeholder, not a real body. Or is it? |

Orbital periods are from JPL's Planetary Physical Parameters, converted at 365.25 days per year. The Moon is tidally locked, so its solar day is simply the mean synodic month (the interval between new moons, which varies by hours in practice). Mercury's result is good to about a minute because of the precision of its orbital period; the others are good to a second or so.

The gas giants have no solid surface, so their "rotation" is defined by something else (the magnetic field or cloud features), and sources disagree:

- **Saturn**: the IAU value above comes from Voyager radio data (1980s). Newer gravity-field and ring-seismology studies point to roughly 10:33 instead.
- **Neptune**: the current IAU value (2015) is from tracking cloud features. NASA's fact sheet still uses the older Voyager radio rotation of 16:06:36, which gives a solar day of 16:06:36.6.
- **Jupiter**: some IAU reports have used a rounded rate of 870.536 deg/day (9:55:30.0); System III (1965) is the defined radio period, which is what is used here.

Choosing a planet fills in the day length field, which is the only thing the clock uses; editing the field afterwards sets the planet list back to *Custom*. So to use other values, just type them, e.g. `16:06:36.6` for Neptune.

Sources: [JPL Planetary Physical Parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html), the [IAU WGCCRE report 2015](https://doi.org/10.1007/s10569-017-9805-5) (rotation rates), the [NASA/PDS Atmospheres longitude systems page](https://pds-atmospheres.nmsu.edu/education_and_outreach/encyclopedia/longitude.htm) (Jupiter System III), and NASA's [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) for comparison.

## Install

1. Install the DSEG fonts (see below).
2. Copy the `non24clock@ragnar` folder to `~/.local/share/cinnamon/desklets/`.
3. Right-click the desktop, choose *Add Desklets*, and add **Non-24 Clock**.

If the desklet does not show up right away, restart Cinnamon (Ctrl+Alt+Esc).
(Or use Looking Glass for this (Alt+F2 - type "lg"), Restart Cinnamon. Or go to Extensions tab - Right-click Non-24 clock desklet -> Restart code)

## Fonts

The desklet uses the [DSEG](https://github.com/keshikan/DSEG) fonts by Keshikan, but does **not** bundle them. On Linux Mint / Debian / Ubuntu:

```
sudo apt install fonts-dseg
```

The digit-shape options need DSEG v0.50 or newer; with older versions the standard digits are shown. Any other installed font can be entered under *Custom font family*.

## License

The desklet code is released under the [MIT License](LICENSE).

DSEG is not part of this repository and is licensed separately by its author under the SIL Open Font License 1.1. If you redistribute the font together with this desklet, include its license and follow its terms.
