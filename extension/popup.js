const $ = (id) => document.getElementById(id);
async function render() {
  const { credential, status } = await chrome.storage.local.get(["credential", "status"]);
  $("pair").hidden = Boolean(credential);
  $("connected").hidden = !credential;
  $("status").textContent = status || (credential ? "Connected." : "Not connected.");
}
$("connect").onclick = async () => {
  $("status").textContent = "Connecting…";
  const reply = await chrome.runtime.sendMessage({ type: "pair", code: $("code").value.trim() });
  if (reply?.error) $("status").textContent = reply.error;
  await render();
};
$("disconnect").onclick = async () => { await chrome.runtime.sendMessage({ type: "disconnect" }); await render(); };
chrome.storage.onChanged.addListener(render);
render();
