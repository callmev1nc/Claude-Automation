type NotificationLevel = 'info' | 'warning' | 'error';

interface NotificationPayload {
  title: string;
  message: string;
  level: NotificationLevel;
}

let notifierModule: any = null;

async function loadNotifier(): Promise<void> {
  if (!notifierModule) {
    try {
      notifierModule = await import('node-notifier');
    } catch {
      notifierModule = null;
    }
  }
}

export async function notify(
  message: string,
  level: NotificationLevel = 'info'
): Promise<void> {
  const title = level === 'error' ? 'AIM Error' : level === 'warning' ? 'AIM Notice' : 'AIM';
  const payload: NotificationPayload = { title, message, level };

  console.log(`[aim] ${level.toUpperCase()}: ${message}`);

  if (process.env.AIM_NO_TOAST) return;

  try {
    await loadNotifier();
    if (notifierModule) {
      notifierModule.notify({
        title: payload.title,
        message: payload.message,
        sound: level === 'error',
        wait: false,
      });
    }
  } catch {
    // toast not available — console is fine
  }
}


