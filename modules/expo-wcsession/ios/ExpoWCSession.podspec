Pod::Spec.new do |s|
  s.name           = 'ExpoWCSession'
  s.version        = '0.1.0'
  s.summary        = 'New Architecture-native WCSession bridge with sequence-numbered inbound events'
  s.description    = 'Expo Modules API bridge to Watch Connectivity (WCSession) on the iPhone side. Every inbound envelope gets a process-scoped (epoch, seq) stamp and lands in a native ring buffer before the JS event fires, so JS can detect delivery gaps and pull-reconcile via getEventsSince — event-emitter bookkeeping failures can no longer lose data.'
  s.author         = 'lisonchang80'
  s.homepage       = 'https://github.com/lisonchang80/TrainingLog'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
