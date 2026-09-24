# AndroidJUnitRunner shares this dependency with the app. Keep its API only
# in instrumented release builds so the runner can call it after app shrinking.
-keep class androidx.tracing.Trace { *; }
-keep class kotlin.jvm.internal.** { *; }
-keep class kotlin.LazyKt** { *; }
# Instrumentation injects synthetic server frames into the real native receive path.
-keep class club.freechess.FreeChessClub.FicsSocketPlugin$Connection { *; }
-keepclassmembers class club.freechess.FreeChessClub.FicsSocketPlugin { *; }
-keep class club.freechess.FreeChessClub.FicsNotifications { *; }
-keep class club.freechess.FreeChessClub.FicsNotifications$* { *; }
-keep class com.getcapacitor.BridgeActivity { public com.getcapacitor.Bridge getBridge(); }
-keep class com.getcapacitor.Bridge { public android.webkit.WebView getWebView(); public com.getcapacitor.PluginHandle getPlugin(java.lang.String); }
-keep class com.getcapacitor.PluginHandle { public com.getcapacitor.Plugin getInstance(); }
-keep interface okhttp3.WebSocket { *; }
-keep class okhttp3.WebSocketListener { *; }
-keep class okio.ByteString { *; }

-keep class club.freechess.FreeChessClub.FicsKeepAlive { *; }
-keep class com.getcapacitor.PluginCall { *; }
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }
-keep class club.freechess.FreeChessClub.FicsTimeseal { *; }
-keep interface okhttp3.WebSocket$Factory { *; }
