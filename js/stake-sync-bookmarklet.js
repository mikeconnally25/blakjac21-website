(function stakeSyncBookmarklet() {
  const params = new URLSearchParams(
    (document.currentScript && document.currentScript.src.split("?")[1]) || ""
  );
  const hashMatch = location.hash.match(/bj21sync=([^&]+)/);
  const token = (hashMatch && hashMatch[1]) || params.get("token") || "";

  if (!token) {
    window.alert("Missing sync token. Start sync from the bonus-hunt admin page first.");
    return;
  }

  if (location.hostname.indexOf("stake.com") === -1) {
    window.open(
      "https://stake.com/casino/group/new-releases#bj21sync=" + encodeURIComponent(token),
      "_blank"
    );
    return;
  }

  const apiOrigin = params.get("origin") || "https://website-blakjac21.vercel.app";
  const query = `query SlugKuratorGroup($slug: String!, $limit: Int!, $offset: Int!) {
    slugKuratorGroup(slug: $slug) {
      name
      groupGamesList(limit: $limit, offset: $offset) {
        game {
          name
          slug
          thumbnailUrl
          groupGames {
            group {
              translation
              type
            }
          }
        }
      }
    }
  }`;

  const limit = 50;
  const maxOffset = 20000;
  const pagesPerPost = 4;

  function setStatus(message) {
    let node = document.getElementById("bj21-stake-sync-status");
    if (!node) {
      node = document.createElement("div");
      node.id = "bj21-stake-sync-status";
      node.style.cssText =
        "position:fixed;z-index:2147483647;left:16px;bottom:16px;max-width:360px;padding:12px 14px;border-radius:10px;background:#0b1220;color:#e8f7ff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid rgba(126,216,255,.35);";
      document.body.appendChild(node);
    }
    node.textContent = message;
  }

  async function fetchPage(slug, offset) {
    const response = await fetch("/_api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        operationName: "SlugKuratorGroup",
        query,
        variables: { slug, limit, offset },
      }),
    });

    if (!response.ok) {
      throw new Error(`Stake request failed (${response.status}).`);
    }

    const data = await response.json();
    if (data?.errors?.length) {
      throw new Error(data.errors[0]?.message || "Stake GraphQL error.");
    }

    return data?.data?.slugKuratorGroup?.groupGamesList || [];
  }

  async function postPartial(groupGamesList, label, progress) {
    const response = await fetch(`${apiOrigin}/api/bonus-hunt/slots/import-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        partial: true,
        progress,
        payload: {
          data: {
            slugKuratorGroup: {
              name: label,
              groupGamesList,
            },
          },
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not import slots.");
    }
    return data;
  }

  async function finishSync() {
    const response = await fetch(`${apiOrigin}/api/bonus-hunt/slots/import-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, done: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not finish sync.");
    }
    return data;
  }

  async function syncGroup(slug, label) {
    let offset = 0;
    let buffer = [];
    let latest = null;

    while (offset < maxOffset) {
      setStatus(`BJ21 sync: loading ${label} @ ${offset}…`);
      const batch = await fetchPage(slug, offset);
      if (!batch.length) {
        break;
      }

      buffer.push(...batch);
      offset += limit;

      if (buffer.length >= limit * pagesPerPost || batch.length < limit) {
        latest = await postPartial(
          buffer,
          label,
          `${label} through ${offset}`
        );
        setStatus(
          `BJ21 sync: saved ${latest.unique || latest.count || 0} unique slots (${label})`
        );
        buffer = [];
      }

      if (batch.length < limit) {
        break;
      }
    }

    if (buffer.length) {
      latest = await postPartial(buffer, label, `${label} complete`);
    }

    return latest;
  }

  async function run() {
    setStatus("BJ21 sync started…");
    await syncGroup("new-releases", "New Releases");
    await syncGroup("only-on-stake", "Only on Stake");
    const data = await finishSync();
    const unique = data.unique || data.count || 0;
    setStatus(`BJ21 sync complete: ${unique} unique slots.`);
    window.alert(
      `Synced ${unique} slots from New Releases and Only on Stake.` +
        (data.withThumbnails
          ? ` ${data.withThumbnails} slot logos loaded.`
          : " Slot logos are still missing — try running the sync again while logged in.")
    );
  }

  run().catch((error) => {
    setStatus(error.message || "Stake slot sync failed.");
    window.alert(error.message || "Stake slot sync failed.");
  });
})();
