#!/bin/bash
# Build APK tanpa Gradle. Pakai: ANDROID_HOME=/path/sdk ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
BT=$ANDROID_HOME/build-tools/35.0.0; JAR=$ANDROID_HOME/platforms/android-34/android.jar
rm -rf build && mkdir -p build/res build/gen build/classes build/dex
$BT/aapt2 compile --dir res -o build/res/res.zip
$BT/aapt2 link -o build/base.apk -I $JAR --manifest AndroidManifest.xml --java build/gen build/res/res.zip --min-sdk-version 21 --target-sdk-version 34 --version-code 2 --version-name 1.1
javac --release 11 -classpath $JAR -d build/classes $(find src build/gen -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
(cd build/classes && jar cf ../classes.jar .)
$BT/d8 --min-api 21 --lib $JAR --output build/dex build/classes.jar
cp build/base.apk build/unsigned.apk && (cd build/dex && zip -q ../unsigned.apk classes.dex)
$BT/zipalign -f -p 4 build/unsigned.apk build/aligned.apk
KS=${KEYSTORE:-release.keystore}
if [ ! -f "$KS" ]; then keytool -genkeypair -keystore "$KS" -alias pks -keyalg RSA -keysize 2048 -validity 10000 -storepass "${KS_PASS:?Isi KS_PASS dulu}" -keypass "${KS_PASS:?Isi KS_PASS dulu}" -dname "CN=Petani Kota Sejahtera, O=PKS, C=ID" >/dev/null 2>&1; fi
$BT/apksigner sign --ks "$KS" --ks-key-alias pks --ks-pass pass:${KS_PASS:?Isi KS_PASS dulu} --out build/PKS-Keuangan.apk build/aligned.apk
$BT/apksigner verify build/PKS-Keuangan.apk && ls -la build/PKS-Keuangan.apk
