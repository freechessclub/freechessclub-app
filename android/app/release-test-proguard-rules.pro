# AndroidJUnitRunner shares this dependency with the app. Keep its API only
# in instrumented release builds so the runner can call it after app shrinking.
-keep class androidx.tracing.Trace { *; }
-keep class kotlin.jvm.internal.** { *; }
-keep class kotlin.LazyKt** { *; }
