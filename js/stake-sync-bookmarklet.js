(function stakeSyncBookmarklet() {
  const params = new URLSearchParams(
    (document.currentScript && document.currentScript.src.split("?")[1]) || ""
  );
  const hashMatch = location.hash.match(/bj21sync=([^&]+)/);
  const token = params.get("token") || (hashMatch && hashMatch[1]) || "";

  if (!token) {
    window.alert("Missing sync token. Start sync from the bonus-hunt admin page first.");
    return;
  }

  const apiOrigin = params.get("origin") || "https://website-blakjac21.vercel.app";
  const query = `query SlugKuratorGroup($slug: String!, $limit: Int!, $offset: Int!) {
    slugKuratorGroup(slug: $slug) {
      name
      groupGamesList(limit: $limit, offset: $offset) {
        game { name slug }
      }
    }
  }`;

  async function loadGroup(slug, label) {
    const groupGamesList = [];

    for (let offset = 0; offset < 1000; offset += 50) {
      const response = await fetch("/_api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          operationName: "SlugKuratorGroup",
          query,
          variables: { slug, limit: 50, offset },
        }),
      });

      if (!response.ok) {
        throw new Error(`Stake request failed (${response.status}).`);
      }

      const data = await response.json();
      const batch = data?.data?.slugKuratorGroup?.groupGamesList || [];
      if (!batch.length) {
        break;
      }

      groupGamesList.push(...batch);
    }

    return {
      data: {
        slugKuratorGroup: {
          name: label,
          groupGamesList,
        },
      },
    };
  }

  async function run() {
    const payload = [
      await loadGroup("new-releases", "New Releases"),
      await loadGroup("only-on-stake", "Only on Stake"),
    ];

    const response = await fetch(`${apiOrigin}/api/bonus-hunt/slots/import-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, payload }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not import slots.");
    }

    window.alert(`Synced ${data.count} slots from New Releases and Only on Stake.`);
  }

  run().catch((error) => {
    window.alert(error.message || "Stake slot sync failed.");
  });
})();
