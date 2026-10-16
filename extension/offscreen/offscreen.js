// Service workers can't create blob URLs, and data: URLs get unreliable past a few MB.
// This offscreen document turns file contents into blob URLs that chrome.downloads can save.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'blob') {
    let blob;
    if (msg.base64 != null) {
      const bin = atob(msg.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: msg.mime });
    } else {
      blob = new Blob([msg.text], { type: msg.mime });
    }
    reply(URL.createObjectURL(blob));
    return;
  }
  if (msg.type === 'revoke') {
    try { URL.revokeObjectURL(msg.url); } catch {}
    reply(true);
  }
});
