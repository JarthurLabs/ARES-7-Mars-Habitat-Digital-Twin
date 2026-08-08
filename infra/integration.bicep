targetScope = 'resourceGroup'

@description('Short lowercase prefix. It must match the prefix used by main.bicep.')
@minLength(3)
@maxLength(9)
param namePrefix string = 'ares7'

@description('Azure region for the integration resources.')
param location string = resourceGroup().location

@description('Deployment stage recorded on every new resource.')
@allowed([
  'development'
  'evidence'
])
param environment string = 'development'

@description('Function event subscriptions stay off until both deployed Function names have been verified.')
@allowed([
  false
])
param enableEventWiring bool = false

@description('Exact browser Origin allowed to request a receive-only Web PubSub grant.')
@allowed([
  'https://jarthurlabs.github.io'
])
param viewerAllowedOrigins string = 'https://jarthurlabs.github.io'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var baseName = '${toLower(namePrefix)}-${suffix}'
var deploymentContainerName = 'function-packages'
var deadLetterContainerName = 'event-dead-letter'
var tags = {
  project: 'ARES-7'
  environment: environment
  purpose: 'portfolio-digital-twin-lab'
  costPolicy: 'free-skus-and-consumption-only'
  cleanup: 'delete-within-72-hours-of-final-evidence'
}

var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'
var digitalTwinsDataOwnerRoleId = 'bcd981a7-7f74-457b-83e1-cceb9e632ffe'
var webPubSubServiceOwnerRoleId = '12cf5a90-567b-43ae-8102-96cf46c7d9b4'

resource digitalTwins 'Microsoft.DigitalTwins/digitalTwinsInstances@2023-01-31' existing = {
  name: 'adt-${baseName}'
}

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' existing = {
  name: 'wps-${baseName}'
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: 'stares7${suffix}'
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
    metadata: {
      project: 'ARES-7'
      content: 'flex-consumption-function-packages'
    }
  }
}

resource deadLetterContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deadLetterContainerName
  properties: {
    publicAccess: 'None'
    metadata: {
      project: 'ARES-7'
      content: 'event-grid-dead-letter'
    }
  }
}

resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-func-${baseName}'
  location: location
  tags: tags
}

resource eventGridIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-eg-${baseName}'
  location: location
  tags: tags
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${baseName}'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.1')
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${baseName}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableLocalAuth: true
  }
}

resource controllerTopic 'Microsoft.EventGrid/topics@2025-02-15' = {
  name: 'egt-${baseName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${eventGridIdentity.id}': {}
    }
  }
  properties: {
    inputSchema: 'EventGridSchema'
    publicNetworkAccess: 'Enabled'
  }
}

resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${baseName}'
  location: location
  kind: 'functionapp'
  tags: tags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
    zoneRedundant: false
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-${baseName}'
  location: location
  kind: 'functionapp,linux'
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainer.name}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: functionIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }

  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      FUNCTIONS_EXTENSION_VERSION: '~4'
      AzureWebJobsStorage__accountName: storage.name
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__clientId: functionIdentity.properties.clientId
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${functionIdentity.properties.clientId};Authorization=AAD'
      AZURE_CLIENT_ID: functionIdentity.properties.clientId
      AZURE_DIGITAL_TWINS_ENDPOINT: 'https://${digitalTwins.properties.hostName}'
      AZURE_WEBPUBSUB_ENDPOINT: 'https://${webPubSub.properties.hostName}'
      AZURE_WEBPUBSUB_HUB: 'ares7'
      VIEWER_ALLOWED_ORIGINS: viewerAllowedOrigins
    }
  }
}

resource functionBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, storageQueueDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionDigitalTwinsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(digitalTwins.id, functionIdentity.id, digitalTwinsDataOwnerRoleId)
  scope: digitalTwins
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', digitalTwinsDataOwnerRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionWebPubSubRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, functionIdentity.id, webPubSubServiceOwnerRoleId)
  scope: webPubSub
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', webPubSubServiceOwnerRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionMonitoringRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, functionIdentity.id, monitoringMetricsPublisherRoleId)
  scope: applicationInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource eventGridDeadLetterRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(deadLetterContainer.id, eventGridIdentity.id, storageBlobDataContributorRoleId)
  scope: deadLetterContainer
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: eventGridIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output functionIdentityName string = functionIdentity.name
output controllerTopicName string = controllerTopic.name
output deploymentContainerName string = deploymentContainer.name
output deadLetterContainerName string = deadLetterContainer.name
output eventWiringEnabled bool = enableEventWiring
output deploymentBoundary object = {
  functionPlan: 'FC1 Flex Consumption; zero always-ready instances'
  functionMaximumInstances: 40
  functionMemoryMb: 2048
  logAnalyticsDailyQuotaGb: json('0.1')
  eventSubscriptions: 'disabled until the live-scenario milestone verifies deployed function names'
  paidFallbackAllowed: false
}
