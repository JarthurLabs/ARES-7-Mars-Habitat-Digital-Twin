targetScope = 'resourceGroup'

@description('Short lowercase prefix. It must match main.bicep and integration.bicep.')
@minLength(3)
@maxLength(9)
param namePrefix string = 'ares7'

@description('Azure region used by the existing ARES-7 resources.')
param location string = resourceGroup().location

@description('The only device allowed to enter the telemetry Function.')
@allowed([
  'ares7-simulator'
])
param deviceId string = 'ares7-simulator'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var baseName = '${toLower(namePrefix)}-${suffix}'
var deadLetterContainerName = 'event-dead-letter'
var controllerEndpointName = 'ares7-controller-topic'
var controllerRouteName = 'ares7-controller-updates'
var controllerRouteFilter = 'type = \'Microsoft.DigitalTwins.Twin.Update\' AND (subject = \'ares7-clock\' OR subject = \'ares7-habitat\')'
var retryPolicy = {
  eventTimeToLiveInMinutes: 60
  maxDeliveryAttempts: 10
}
var tags = {
  project: 'ARES-7'
  purpose: 'portfolio-digital-twin-lab'
  costPolicy: 'free-skus-and-consumption-only'
  cleanup: 'delete-within-72-hours-of-final-evidence'
}

resource digitalTwins 'Microsoft.DigitalTwins/digitalTwinsInstances@2023-01-31' existing = {
  name: 'adt-${baseName}'
}

resource iotHub 'Microsoft.Devices/IotHubs@2023-06-30' existing = {
  name: 'iot-${baseName}'
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: 'stares7${suffix}'
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource deadLetterContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobService
  name: deadLetterContainerName
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' existing = {
  name: 'func-${baseName}'
}

resource eventGridIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'id-eg-${baseName}'
}

resource controllerTopic 'Microsoft.EventGrid/topics@2025-02-15' existing = {
  name: 'egt-${baseName}'
}

// Event Grid is the only Azure Digital Twins endpoint type that still requires
// topic keys. The key is resolved inside ARM and is never a parameter or output.
resource controllerEndpoint 'Microsoft.DigitalTwins/digitalTwinsInstances/endpoints@2023-01-31' = {
  parent: digitalTwins
  name: controllerEndpointName
  properties: {
    endpointType: 'EventGrid'
    TopicEndpoint: controllerTopic.properties.endpoint
    accessKey1: controllerTopic.listKeys().key1
  }
}

resource iotTelemetrySystemTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: 'egst-iot-${baseName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${eventGridIdentity.id}': {}
    }
  }
  properties: {
    source: iotHub.id
    topicType: 'Microsoft.Devices.IoTHubs'
  }
}

resource iotTelemetrySubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: iotTelemetrySystemTopic
  name: 'ares7-device-telemetry-to-ingest'
  properties: {
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: '${functionApp.id}/functions/ingestTelemetry'
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }
    deadLetterWithResourceIdentity: {
      deadLetterDestination: {
        endpointType: 'StorageBlob'
        properties: {
          resourceId: storage.id
          blobContainerName: deadLetterContainer.name
        }
      }
      identity: {
        type: 'UserAssigned'
        userAssignedIdentity: eventGridIdentity.id
      }
    }
    eventDeliverySchema: 'EventGridSchema'
    filter: {
      includedEventTypes: [
        'Microsoft.Devices.DeviceTelemetry'
      ]
      // IoT Hub telemetry subjects are devices/<device-id>. Requiring both the
      // exact prefix and suffix prevents similarly named devices from matching.
      subjectBeginsWith: 'devices/${deviceId}'
      subjectEndsWith: 'devices/${deviceId}'
      isSubjectCaseSensitive: true
      advancedFilters: []
      enableAdvancedFilteringOnArrays: false
    }
    retryPolicy: retryPolicy
    labels: [
      'ares7'
      'single-device'
      'telemetry-only'
    ]
  }
}

resource controllerSubscription 'Microsoft.EventGrid/topics/eventSubscriptions@2022-06-15' = {
  parent: controllerTopic
  name: 'ares7-twin-updates-to-controller'
  properties: {
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: '${functionApp.id}/functions/emergencyController'
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }
    deadLetterWithResourceIdentity: {
      deadLetterDestination: {
        endpointType: 'StorageBlob'
        properties: {
          resourceId: storage.id
          blobContainerName: deadLetterContainer.name
        }
      }
      identity: {
        type: 'UserAssigned'
        userAssignedIdentity: eventGridIdentity.id
      }
    }
    eventDeliverySchema: 'EventGridSchema'
    filter: {
      includedEventTypes: [
        'Microsoft.DigitalTwins.Twin.Update'
      ]
      subjectBeginsWith: ''
      subjectEndsWith: ''
      isSubjectCaseSensitive: true
      advancedFilters: [
        {
          key: 'subject'
          operatorType: 'StringIn'
          values: [
            'ares7-clock'
            'ares7-habitat'
          ]
        }
      ]
      enableAdvancedFilteringOnArrays: false
    }
    retryPolicy: retryPolicy
    labels: [
      'ares7'
      'clock-and-approval-only'
    ]
  }
}

// Event routes are Azure Digital Twins data-plane objects, not ARM resources.
// scripts/azure/wire-events.mjs creates or verifies this exact route after this
// template succeeds.
output digitalTwinsRoute object = {
  name: controllerRouteName
  endpointName: controllerEndpoint.name
  filter: controllerRouteFilter
}
output iotEventSubscriptionName string = iotTelemetrySubscription.name
output controllerEventSubscriptionName string = controllerSubscription.name
output retryAndDeadLetterPolicy object = {
  eventTimeToLiveInMinutes: retryPolicy.eventTimeToLiveInMinutes
  maxDeliveryAttempts: retryPolicy.maxDeliveryAttempts
  deadLetterContainer: deadLetterContainer.name
  identity: eventGridIdentity.name
}
