# ==============================================================================
# ProGuard / R8 Rules for Maquaty App (Safe Build Optimization)
# ==============================================================================

# 1. Flutter Engine & Embedding
-keep class io.flutter.** { *; }
-dontwarn io.flutter.**
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.embedding.** { *; }

# 2. Application Classes & Native JNI Calls
-keep class com.kareemtech.maquaty.** { *; }
-dontwarn com.kareemtech.maquaty.**

# 3. Preserve JNI native method signatures & MethodChannel
-keepclasseswithmembernames class * {
    native <methods>;
}
-keep class io.flutter.plugin.common.** { *; }

# 4. Preserve Flutter plugin registration & reflection
-keep class * implements io.flutter.plugin.common.PluginRegistry$PluginRegistrantCallback { *; }
-keep class * implements io.flutter.embedding.engine.plugins.FlutterPlugin { *; }
-keep class * implements io.flutter.embedding.engine.plugins.activity.ActivityAware { *; }

# 5. Core Plugins Keep Rules (sqflite, secure_storage, printing, dio, image_picker)
# sqflite
-keep class com.tekartik.sqflite.** { *; }
-dontwarn com.tekartik.sqflite.**

# flutter_secure_storage
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-dontwarn com.it_nomads.fluttersecurestorage.**

# printing & pdf
-keep class net.nfet.flutter.printing.** { *; }
-dontwarn net.nfet.flutter.printing.**

# shared_preferences & path_provider
-keep class io.flutter.plugins.sharedpreferences.** { *; }
-keep class io.flutter.plugins.pathprovider.** { *; }
-keep class io.flutter.plugins.imagepicker.** { *; }
-keep class dev.fluttercommunity.plus.connectivity.** { *; }
-keep class dev.fluttercommunity.plus.device_info.** { *; }

# 6. Keep AndroidX & Kotlin Standard Library
-dontwarn androidx.**
-keep class androidx.** { *; }
-keep class kotlin.** { *; }
-keep class kotlin.reflect.** { *; }
-dontwarn kotlin.**

# 7. Preserve Line Numbers & Attributes for Crashlytics / Debugging
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses
-keepattributes Signature

