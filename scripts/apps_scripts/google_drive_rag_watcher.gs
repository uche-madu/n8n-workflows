// List of drives/folders to monitor and their webhook URLs
const WATCH_CONFIG = [
  {
    ROOT_FOLDER_ID: '1ktOMiYII_mrwJzyvoLzns9mHIJ3pGFFB', // Clients
    WEBHOOK_URL: 'https://divverse-community.app.n8n.cloud/webhook/new-drive-file'
  },
  {
    ROOT_FOLDER_ID: '121SAFQMQW7j49DAwGpvlmksuS2iggJm4', // 3MTT Chatbot Documents
    WEBHOOK_URL: 'https://primary-production-9f0f4.up.railway.app/webhook/new-drive-file'
  },
  {
    ROOT_FOLDER_ID: '1Q8vFHvuG6Hh2YEHJOuS0m69s2ORqJByt', // AI Customer Service Rep n8n Automation
    WEBHOOK_URL: 'https://divverse-community.app.n8n.cloud/webhook/ai-csr-knowledgebase-new-drive-file'
  }
  // 👉 add more as needed
];

const CACHE_KEY = 'processedFiles';

function checkNewFiles() {
  const cache = PropertiesService.getScriptProperties();
  const processed = JSON.parse(cache.getProperty(CACHE_KEY) || '{}'); // fileKey -> lastUpdated
  let updatedCache = { ...processed };

  WATCH_CONFIG.forEach(cfg => {
    const folder = DriveApp.getFolderById(cfg.ROOT_FOLDER_ID);
    const newFiles = listFilesRecursively(folder);

    newFiles.forEach(f => {
      const fileKey = `${cfg.ROOT_FOLDER_ID}:${f.id}`; // namespace per drive/folder
      const prevTimestamp = processed[fileKey];
      const updatedTime = f.updated;

      if (!prevTimestamp || new Date(updatedTime) > new Date(prevTimestamp)) {
        try {
          const response = UrlFetchApp.fetch(cfg.WEBHOOK_URL, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(f),
            muteHttpExceptions: true
          });
          Logger.log(`[${cfg.ROOT_FOLDER_ID}] Sent ${f.name} → ${response.getResponseCode()} – ${response.getContentText()}`);
        } catch (err) {
          Logger.log(`[${cfg.ROOT_FOLDER_ID}] Error sending ${f.name}: ${err}`);
        }

        // Update cache
        updatedCache[fileKey] = updatedTime;
      }
    });
  });

  cache.setProperty(CACHE_KEY, JSON.stringify(updatedCache));
}

function listFilesRecursively(folder, parentPath = '') {
  const fileList = [];
  const p = parentPath + '/' + folder.getName();
  const files = folder.getFiles();

  while (files.hasNext()) {
    const f = files.next();
    Logger.log(`Found file: ${f.getName()} in ${p}`);
    fileList.push({
      id: f.getId(),
      name: f.getName(),
      path: p,
      mimeType: f.getMimeType(),
      updated: f.getLastUpdated().toISOString()
    });
  }

  const subs = folder.getFolders();
  while (subs.hasNext()) {
    fileList.push(...listFilesRecursively(subs.next(), p));
  }

  return fileList;
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  // Optionally route based on some payload property or drive ID
  WATCH_CONFIG.forEach(cfg => {
    UrlFetchApp.fetch(cfg.WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });
  });
  return ContentService.createTextOutput('OK');
}

function resetProcessedFiles() {
  PropertiesService.getScriptProperties().deleteProperty(CACHE_KEY);
}
