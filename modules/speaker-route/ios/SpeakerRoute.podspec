Pod::Spec.new do |s|
  s.name           = 'SpeakerRoute'
  s.version        = '1.0.0'
  s.summary        = 'Routes CD4 voice-chat audio to the loudspeaker'
  s.description    = 'Routes CD4 voice-chat audio to the loudspeaker'
  s.author         = 'CD4'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
