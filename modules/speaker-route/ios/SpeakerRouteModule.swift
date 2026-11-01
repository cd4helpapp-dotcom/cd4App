import AVFoundation
import ExpoModulesCore

// Sends voice-chat (WebRTC) audio to the loudspeaker instead of the earpiece. Errors return false.
public class SpeakerRouteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpeakerRoute")

    Function("enableSpeaker") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().overrideOutputAudioPort(.speaker)
        return true
      } catch {
        return false
      }
    }

    Function("reset") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().overrideOutputAudioPort(.none)
        return true
      } catch {
        return false
      }
    }
  }
}
