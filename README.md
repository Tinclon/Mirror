# Raison d'Étre (Rationale)
This repo contains node code to mirror files and directories from a MASTER volume to a SLAVE volume.

# Setup
On the MASTER volume, create an empty file at the root level named "MASTER"

On the SLAVE volume, create an empty file at the root level named "SLAVE"

Mirror will recursively visit all directories on the MASTER and SLAVE volumes, mirroring MASTER to SLAVE.

Files at the root level of the volumes will not be affected.

# Requirements

`node >= 14`

# Installation

`yarn install`

# Usage

`yarn start`

# Note

!! USE AT YOUR OWN RISK !!

This utility can and will delete files from volumes tagged as SLAVE.
