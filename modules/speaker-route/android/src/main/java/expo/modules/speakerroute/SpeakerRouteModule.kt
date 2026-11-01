package expo.modules.speakerroute

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Sends voice-chat (WebRTC) audio to the loudspeaker. Many phones otherwise play it on the quiet earpiece
// because WebRTC audio is "communication" audio. Deliberately minimal: no threads, receivers, sensors or
// Bluetooth handling, and every call is wrapped so a device quirk returns false instead of crashing.
class SpeakerRouteModule : Module() {
  private var previousMode: Int? = null

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("SpeakerRoute")

    Function("enableSpeaker") {
      val manager = audioManager ?: return@Function false
      try {
        if (previousMode == null) previousMode = manager.mode
        // Communication mode enables the phone's echo cancellation for the two-way voice chat.
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val speaker = manager.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
          speaker != null && manager.setCommunicationDevice(speaker)
        } else {
          @Suppress("DEPRECATION")
          manager.isSpeakerphoneOn = true
          true
        }
      } catch (error: Exception) {
        Log.w("SpeakerRoute", "enableSpeaker failed", error)
        false
      }
    }

    Function("reset") {
      val manager = audioManager ?: return@Function false
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          manager.clearCommunicationDevice()
        } else {
          @Suppress("DEPRECATION")
          manager.isSpeakerphoneOn = false
        }
        manager.mode = previousMode ?: AudioManager.MODE_NORMAL
        previousMode = null
        true
      } catch (error: Exception) {
        Log.w("SpeakerRoute", "reset failed", error)
        false
      }
    }
  }
}
