const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pixelAgentsDesktop', {
  chooseProjectFolder: () => ipcRenderer.invoke('pixel-agents:choose-project-folder'),
});
