#!/bin/bash
# Extract snapshot asset directories from their zip archives.
# Run once after cloning the repo.
for z in *_files.zip; do
  dir="${z%.zip}"
  [ -d "$dir" ] || unzip -o "$z"
done
rm -rf __MACOSX
