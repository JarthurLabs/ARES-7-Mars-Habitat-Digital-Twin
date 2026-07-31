targetScope = 'resourceGroup'

@description('Short lowercase prefix. A unique suffix is added automatically.')
@minLength(3)
@maxLength(9)
param namePrefix string = 'ares7'

@description('Azure region for all supported resources.')
param location string = resourceGroup().location

@description('Deployment stage recorded on every resource.')
@allowed([
  'development'
  'evidence'
])
param environment string = 'development'

@description('Fail-closed cost gate. This lab never converts IoT Hub to a paid SKU.')
@allowed([
  'F1'
])
param iotHubSku string = 'F1'

@description('Fail-closed cost gate. This lab never converts Web PubSub to a paid SKU.')
@allowed([
  'Free_F1'
])
param webPubSubSku string = 'Free_F1'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var baseName = '${toLower(namePrefix)}-${suffix}'
var tags = {
  project: 'ARES-7'
  environment: environment
  purpose: 'portfolio-digital-twin-lab'
  costPolicy: 'free-skus-and-consumption-only'
  cleanup: 'delete-within-72-hours-of-final-evidence'
}

resource digitalTwins 'Microsoft.DigitalTwins/digitalTwinsInstances@2023-01-31' = {
  name: 'adt-${baseName}'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

resource iotHub 'Microsoft.Devices/IotHubs@2023-06-30' = {
  name: 'iot-${baseName}'
  location: location
  tags: tags
  sku: {
    name: iotHubSku
    capacity: 1
  }
  properties: {
    disableDeviceSAS: false
    disableLocalAuth: true
    disableModuleSAS: true
    publicNetworkAccess: 'Enabled'
    minTlsVersion: '1.2'
    ipFilterRules: []
    networkRuleSets: {
      defaultAction: 'Allow'
      applyToBuiltInEventHubEndpoint: false
      ipRules: []
    }
  }
}

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: 'wps-${baseName}'
  location: location
  tags: tags
  sku: {
    name: webPubSubSku
    tier: 'Free'
    capacity: 1
  }
  properties: {
    disableAadAuth: false
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    tls: {
      clientCertEnabled: false
    }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stares7${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    isHnsEnabled: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
      ipRules: []
      virtualNetworkRules: []
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [
            'https://explorer.digitaltwins.azure.net'
          ]
          allowedMethods: [
            'GET'
            'OPTIONS'
            'POST'
            'PUT'
          ]
          allowedHeaders: [
            'Authorization'
            'x-ms-version'
            'x-ms-blob-type'
            'content-type'
          ]
          exposedHeaders: [
            'ETag'
            'x-ms-request-id'
          ]
          maxAgeInSeconds: 3600
        }
      ]
    }
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource sceneContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'ares7-3d-scenes'
  properties: {
    publicAccess: 'None'
    metadata: {
      project: 'ARES-7'
      content: 'private-3d-scenes-studio-assets'
    }
  }
}

resource evidenceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'evidence-private'
  properties: {
    publicAccess: 'None'
    metadata: {
      project: 'ARES-7'
      content: 'private-run-evidence'
    }
  }
}

output digitalTwinsName string = digitalTwins.name
output digitalTwinsHostName string = digitalTwins.properties.hostName
output iotHubName string = iotHub.name
output webPubSubName string = webPubSub.name
output storageAccountName string = storage.name
output sceneContainerName string = sceneContainer.name
output evidenceContainerName string = evidenceContainer.name
output deploymentCostPolicy object = {
  iotHub: 'F1 only; deployment fails if unavailable'
  webPubSub: 'Free_F1 only; deployment fails if unavailable'
  storage: 'Standard_LRS; private containers'
  digitalTwins: 'metered operations only'
  paidFallbackAllowed: false
}
