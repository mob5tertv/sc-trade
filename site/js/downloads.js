// The count of the downloads (the author: «как мне узнать, сколько людей скачали программу»). A press of a button «Скачать» tells the
// service of the site which version it gives and in which language the page is — a beacon, sent while the download starts and never in its
// way. Nothing else goes: no address is kept by the service, no cookie is set, nothing of the browser is read (the page «О данных» says so).
// Without a script, or when the service does not answer, the button downloads all the same and nothing is counted.

function startDownloadCount() {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
  for (const link of /** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('a[download][href*="SC-Trade-"]'))) {
    const version = /SC-Trade-(\d{1,3}\.\d{1,3}\.\d{1,3})-setup\.exe/.exec(link.getAttribute('href') ?? '')?.[1];
    if (version === undefined) continue;
    link.addEventListener('click', () => {
      try {
        const body = new Blob([JSON.stringify({ version, lang })], { type: 'text/plain' });
        navigator.sendBeacon?.('/api/download', body);
      } catch {
        // a count that cannot be sent is no reason for the download to fail
      }
    });
  }
}

startDownloadCount();
