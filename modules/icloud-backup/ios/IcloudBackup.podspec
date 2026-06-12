Pod::Spec.new do |s|
  s.name           = 'IcloudBackup'
  s.version        = '1.0.0'
  s.summary        = 'Thin iCloud Drive ubiquity-container bridge for TrainingLog backups'
  s.description    = 'Local Expo module (slice 15, ADR-0011): exposes ubiquity container availability/URL, NSMetadataQuery-backed backup listing, and ubiquitous item download to JS. File moving itself is done in JS via expo-file-system.'
  s.author         = 'TrainingLog'
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
