"use strict";

let dot = false;
console.status = args => ((dot && console.info()) || true) && (console.info(args) || true) && (dot = false);
console.dot = () => (dot = true) && process.stdout.write(".");

import { join, sep } from "path";
import { inspect } from "util";
import fs_extra from "fs-extra";
const { readdirSync, lstatSync, existsSync, mkdirSync, removeSync, copySync, readlinkSync, symlinkSync, lutimesSync } = fs_extra;

const forbiddenVolumes = {};
forbiddenVolumes["Macintosh HD"] = true;

const forbiddenDirectories = {};
forbiddenDirectories["Movies"] = true;
forbiddenDirectories["$RECYCLE.BIN"] = true;
forbiddenDirectories[".Spotlight-V100"] = true;
forbiddenDirectories[".fseventsd"] = true;
forbiddenDirectories[".Trashes"] = true;
forbiddenDirectories[".TemporaryItems"] = true;
forbiddenDirectories["System Volume Information"] = true;

const forbiddenFiles = {};
forbiddenFiles["Thumbs.db"] = true;
forbiddenFiles["desktop.ini"] = true;
forbiddenFiles[".DS_Store"] = true;

const paths = {
    R: "/Volumes",  // ROOT
    M: "",          // MASTER
    S: ""           // SLAVE
};

const getDirectories = srcpath => readdirSync(srcpath).filter(file => lstatSync(join(srcpath, file)).isDirectory());
const getFiles = srcpath => readdirSync(srcpath).filter(file => !lstatSync(join(srcpath, file)).isDirectory());
const pathExists = srcpath => existsSync(srcpath);
const createDirectory = srcpath => mkdirSync(srcpath);
const deleteFile = srcpath => removeSync(srcpath);
const deleteDirectory = srcpath => removeSync(srcpath);
const copyFile = (srcpath, destpath) => copySync(srcpath, destpath) || lutimesSync(destpath, lstatSync(srcpath).atime, lstatSync(srcpath).mtime);
const getTimestamp = srcpath => new Date(inspect(lstatSync(srcpath).mtime));
const timestampsDiffer = (timestamp1, timestamp2) =>
    Math.abs(timestamp1.getTime() - timestamp2.getTime()) >= 2000 &&
        // Account for DST
        Math.abs(timestamp1.getTime() + (1000 * 60 * 60) - timestamp2.getTime()) >= 2000 &&
        Math.abs(timestamp1.getTime() - (1000 * 60 * 60) - timestamp2.getTime()) >= 2000;

function formatPath(srcpath) {
    if (srcpath.length < 500) { return srcpath; }
    const parts = srcpath.split(sep);
    let mid = parts.length >> 1, delta = 0;
    while(mid + delta >= 0 && parts[mid + delta] === "…") { --delta; }
    mid + delta >= 0 && (parts[mid + delta] = "…");
    mid - delta < parts.length && (parts[mid - delta] = "…");
    return formatPath(parts.join(sep));
}

function mirrorFiles(mFullDirectory, sFullDirectory) {

    // ** FILES **
    {
        const mFiles = getFiles(mFullDirectory);
        const sFiles = getFiles(sFullDirectory);
        sFiles.filter(sFile => !forbiddenFiles[sFile]).filter(sFile => !sFile.startsWith("._")).forEach(sFile => {
            if (!mFiles.filter(mFile => mFile === sFile).length) {
                // Exists in SLAVE, not in MASTER. Delete file from SLAVE.
                console.status(`delete file\t${formatPath(join(sFullDirectory, sFile))}`);
                deleteFile(join(sFullDirectory, sFile));
            }
        });
    }
    {
        const mFiles = getFiles(mFullDirectory);
        const sFiles = getFiles(sFullDirectory);
        mFiles.filter(mFile => !forbiddenFiles[mFile]).filter(sFile => !sFile.startsWith("._")).forEach(mFile => {
            if (!sFiles.filter(sFile => sFile === mFile).length) {
                // Exists in MASTER, not in SLAVE. Copy file to SLAVE.
                console.status(`copy file\t${formatPath(join(sFullDirectory, mFile))}`);
                copyFile(join(mFullDirectory, mFile), join(sFullDirectory, mFile));
            } else {
                // Exists in MASTER and in SLAVE. Compare modification timestamps.
                const mModificationTime = getTimestamp(join(mFullDirectory, mFile));
                const sModificationTime = getTimestamp(join(sFullDirectory, mFile));
                if(timestampsDiffer(mModificationTime, sModificationTime)) {
                    // Files were modified at a different time. Copy file to SLAVE (and overwrite).
                    console.status(`update file\t${formatPath(join(sFullDirectory, mFile))}`);
                    console.status(`master timestamp\t${mModificationTime}`);
                    console.status(`slave timestamp\t${sModificationTime}`);
                    copyFile(join(mFullDirectory, mFile), join(sFullDirectory, mFile));
                }
            }
        });
    }

    // ** DIRECTORIES **
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        sDirectories.filter(sDirectory => !forbiddenDirectories[sDirectory]).forEach(sDirectory => {
            if (!mDirectories.filter(mDirectory => mDirectory === sDirectory).length) {
                // Exists in SLAVE, not in MASTER. Delete directory from SLAVE.
                console.status(`delete dir\t${formatPath(join(sFullDirectory, sDirectory))}`);
                deleteDirectory(join(sFullDirectory, sDirectory));
            }
        });
    }
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        mDirectories.filter(mDirectory => !forbiddenDirectories[mDirectory]).forEach(mDirectory => {
            if (!sDirectories.filter(sDirectory => sDirectory === mDirectory).length) {
                // Exists in MASTER, not in SLAVE. Create directory on SLAVE.
                console.status(`create dir\t${formatPath(join(sFullDirectory, mDirectory))}`);
                createDirectory(join(sFullDirectory, mDirectory));
            }
            console.dot();
            // Exists in MASTER and in SLAVE. Recurse.
            mirrorFiles(join(mFullDirectory, mDirectory), join(sFullDirectory, mDirectory));
        });
    }
}

(function mirror() {
    // Start by finding the MASTER and SLAVE Volumes
    const volumes = getDirectories(paths.R);
    volumes.filter(volume => !forbiddenVolumes[volume]).forEach(volume => {
        const files = getFiles(join(paths.R, volume));
        paths.M = paths.M || files.filter(file => file === "MASTER")[0] && volume;
        paths.S = paths.S || files.filter(file => file === "SLAVE")[0] && volume;
    });

    if(!paths.M) {
        // MASTER Volume is not connected. Tell user and quit.
        console.info("Error: MASTER does not exist");
        return;
    }

    if(!paths.S) {
        // SLAVE Volume is not connected. Tell user and quit.
        console.info("Error: SLAVE does not exist");
        return;
    }

    const masterDirectories = getDirectories(join(paths.R, paths.M));
    masterDirectories.filter(directory => !forbiddenDirectories[directory]).forEach(directory => {
        const mDirectory = join(paths.R, paths.M, directory);
        const sDirectory = join(paths.R, paths.S, directory);
        !pathExists(sDirectory) && (createDirectory(sDirectory) || console.status(`create dir\t${formatPath(sDirectory)}`));
        mirrorFiles(mDirectory, sDirectory);
    });
    console.info();

})();
