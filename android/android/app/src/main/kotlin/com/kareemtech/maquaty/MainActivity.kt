package com.kareemtech.maquaty

import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.kareemtech.maquaty/whatsapp"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            if (call.method == "launchWhatsApp") {
                val phone = call.argument<String>("phone") ?: ""
                try {
                    val cleanPhone = phone.replace("+", "").replace(" ", "").trim()
                    val intent = Intent(Intent.ACTION_VIEW)
                    intent.data = Uri.parse("https://wa.me/$cleanPhone")
                    startActivity(intent)
                    result.success(true)
                } catch (e: Exception) {
                    result.error("LAUNCH_FAILED", e.message, null)
                }
            } else {
                result.notImplemented()
            }
        }
    }
}

