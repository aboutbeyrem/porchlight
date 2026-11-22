// Porchlight's words in French and Arabic. English is the key: t("Check now") returns the sentence in the chosen
// language, or the English one when a translation is missing. {name}-style holes are filled from `vars`.
// Findings and alerts are written by the Rust side in the chosen language; this file covers the window itself.
let LANG = "en";
const LOCALE = { en: "en-GB", fr: "fr-FR", ar: "ar-TN" };

const DICT = {
  fr: {
    // window and welcome
    "Skip to content": "Aller au contenu", "Minimize": "Réduire", "Maximize": "Agrandir", "Close to tray": "Fermer dans la zone de notification",
    "Turn the light on your home network.": "Allumez la lumière sur votre réseau.",
    "A calm guard for your home": "Un gardien calme pour votre maison",
    "Porchlight sits quietly in your tray and tells you, in plain words, when something changes at home: someone new joins your Wi-Fi, something pretends to be your router, or a setting leaves a door open.":
      "Porchlight reste discrètement dans la zone de notification et vous dit, avec des mots simples, quand quelque chose change chez vous : quelqu'un de nouveau rejoint votre Wi-Fi, quelque chose se fait passer pour votre routeur, ou un réglage laisse une porte ouverte.",
    "It only looks.": "Il ne fait que regarder.", "No logins, no password guessing, nothing that could disturb your devices.": "Aucune connexion, aucun mot de passe deviné, rien qui puisse déranger vos appareils.",
    "It stays on this computer.": "Il reste sur cet ordinateur.", "No account, no cloud. Delete everything with one button.": "Pas de compte, pas de cloud. Tout s'efface d'un seul bouton.",
    "It tells you what to do,": "Il vous dit quoi faire,", "one step at a time, and checks that the fix worked.": "une étape à la fois, et vérifie que la correction a marché.",
    "Your network": "Votre réseau", "Your router": "Votre routeur", "Your Wi-Fi": "Votre Wi-Fi",
    "So Porchlight can spot fake copies of it. It never asks for your Wi-Fi password.": "Pour que Porchlight repère les fausses copies. Il ne demande jamais votre mot de passe Wi-Fi.",
    "This is my network and I'm allowed to watch it.": "C'est mon réseau et j'ai le droit de le surveiller.",
    "Turn the light on": "Allumer la lumière", "Not connected": "Pas connecté", "Choose your Wi-Fi…": "Choisissez votre Wi-Fi…", "No Wi-Fi adapter (skip)": "Pas d'adaptateur Wi-Fi (passer)", " (connected)": " (connecté)",
    // navigation
    "Sections": "Sections", "Home": "Accueil", "Who's here": "Qui est là", "Wi-Fi": "Wi-Fi", "History": "Historique", "Settings": "Réglages",
    "Starting…": "Démarrage…", "Install update": "Installer la mise à jour", "Check now": "Vérifier maintenant", "Checking…": "Vérification…",
    "Paused": "En pause", "Watching quietly": "Veille en silence", "Away from home": "Hors de chez vous", "Checked {when}": "Vérifié {when}",
    "Porchlight {v} is ready: newer checks and fixes.": "Porchlight {v} est prêt : nouvelles vérifications et corrections.",
    // home
    "Taking a first look…": "Premier coup d'œil…", "Someone new joined your network": "Quelqu'un de nouveau a rejoint votre réseau",
    "What Porchlight keeps watch over": "Ce que Porchlight surveille", "Also on your list": "Aussi sur votre liste", "Good to know": "Bon à savoir",
    "You said these are fine": "Vous avez dit que c'est normal", "Your home at a glance": "Votre maison en un coup d'œil",
    "Your home tonight": "Votre maison ce soir", "Your home this morning": "Votre maison ce matin", "Your home this afternoon": "Votre maison cet après-midi", "Your home this evening": "Votre maison ce soir",
    "Map of your home network": "Carte de votre réseau", "Fix soon": "À corriger bientôt", "Worth fixing": "À corriger", "Through your extender": "Par votre répéteur",
    "Lately": "Récemment", "All history": "Tout l'historique",
    "This takes about a minute. You can close the window: Porchlight keeps going in the tray.": "Cela prend environ une minute. Vous pouvez fermer la fenêtre : Porchlight continue dans la zone de notification.",
    "You're away from home.": "Vous n'êtes pas chez vous.",
    "Porchlight watches your home network and picks up again when you're back. It still watches the Wi-Fi around you here.": "Porchlight surveille votre réseau domestique et reprend à votre retour. Il surveille quand même le Wi-Fi autour de vous ici.",
    "Someone you don't recognise is on your Wi-Fi.": "Quelqu'un que vous ne reconnaissez pas est sur votre Wi-Fi.",
    "{count} you don't recognise are on your Wi-Fi.": "{count} que vous ne reconnaissez pas sont sur votre Wi-Fi.",
    "Changing your Wi-Fi password sends them away. The steps are below.": "Changer le mot de passe Wi-Fi les fait partir. Les étapes sont ci-dessous.",
    "All quiet at home.": "Tout est calme à la maison.", "{count} here, and nothing needs you. Porchlight keeps watching from the tray.": "{count} ici, et rien ne demande votre attention. Porchlight continue de veiller depuis la zone de notification.",
    "One thing should be fixed soon.": "Une chose devrait être corrigée bientôt.", "{count} should be fixed soon.": "{count} devraient être corrigées bientôt.",
    "Your home is mostly safe.": "Votre maison est plutôt sûre.", "Someone new joined your network.": "Quelqu'un de nouveau a rejoint votre réseau.",
    "{count} joined your network.": "{count} ont rejoint votre réseau.", "Tell Porchlight whether you know them.": "Dites à Porchlight si vous les connaissez.",
    "{count} to do": "{count} à faire", ", and someone new to check": ", et quelqu'un de nouveau à vérifier", ". The next one takes about {n} minutes.": ". La prochaine prend environ {n} minutes.",
    "Checking now": "Vérification en cours", "checked {when}": "vérifié {when}", "first look": "premier coup d'œil",
    "part:morning": "matin", "part:afternoon": "après-midi", "part:evening": "soir", "part:night": "nuit",
    "Next step · about {n} minutes": "Prochaine étape · environ {n} minutes",
    "Who joins your Wi-Fi": "Qui rejoint votre Wi-Fi", "You'll hear about anyone new within a few minutes.": "Vous serez prévenu de toute arrivée en quelques minutes.", "Watching": "Sous surveillance",
    "Something pretending to be your router is caught as it happens.": "Ce qui se fait passer pour votre routeur est repéré sur le moment.",
    "Fake copies of your Wi-Fi": "Fausses copies de votre Wi-Fi", "Something nearby uses your Wi-Fi's name. See Wi-Fi.": "Quelque chose à proximité utilise le nom de votre Wi-Fi. Voir Wi-Fi.",
    "Nothing nearby uses your Wi-Fi's name.": "Rien à proximité n'utilise le nom de votre Wi-Fi.", "{n} nearby": "{n} à proximité", "None": "Aucune",
    "Being kicked off the Wi-Fi": "Éjection du Wi-Fi", "Listened for live, between checks.": "Écouté en direct, entre les vérifications.", "Listening": "À l'écoute", "Off": "Désactivé", "On": "Activé",
    "Your DNS": "Votre DNS", "If the address book your computer uses for websites changes, you'll know.": "Si le carnet d'adresses que votre ordinateur utilise pour les sites change, vous le saurez.",
    "Not recognised": "Non reconnu", "Someone new joined your network. Is it yours?": "Quelqu'un de nouveau a rejoint votre réseau. Est-ce à vous ?", "Some new devices joined. Are they yours?": "De nouveaux appareils sont arrivés. Sont-ils à vous ?",
    "Nothing has happened yet.": "Rien ne s'est encore passé.", " (new)": " (nouveau)",
    // findings
    "On your router": "Sur votre routeur", "On {name}": "Sur {name}", "On this computer": "Sur cet ordinateur", "In your network settings": "Dans vos réglages réseau",
    "Undo": "Annuler", "Okay. Porchlight won't bring this up again.": "D'accord. Porchlight n'en parlera plus.",
    "It's still there. Some devices only apply a change after a restart: restart it, wait a minute, then check again.": "C'est toujours là. Certains appareils n'appliquent un changement qu'après un redémarrage : redémarrez-le, attendez une minute, puis vérifiez de nouveau.",
    "Checking your home again. This takes about a minute.": "Nouvelle vérification de votre maison. Cela prend environ une minute.",
    "What Porchlight saw": "Ce que Porchlight a vu", "How likely it matters: {x}": "Risque réel : {x}", "I did it, check again": "C'est fait, vérifier de nouveau",
    "Show me another": "Montrez-m'en une autre", "Do this one next": "Faire celle-ci ensuite", "It's fine, stop telling me": "C'est normal, ne m'en parlez plus",
    "{n} min": "{n} min", "Put it back on my list": "Remettre sur ma liste", "Got it, hide this": "Compris, masquer",
    "Offline": "Hors ligne", "No problems found": "Aucun problème trouvé",
    "Saved. Porchlight will call it \"{name}\".": "Enregistré. Porchlight l'appellera « {name} ».", "For example: Mum's phone": "Par exemple : téléphone de maman", "Name for {name}": "Nom pour {name}", "Save": "Enregistrer", "Skip": "Passer",
    "you didn't recognise it": "vous ne l'avez pas reconnu", "joined {when}": "arrivé {when}", "through your extender": "par votre répéteur",
    "Actually, it's ours": "En fait, il est à nous", "Thanks. Porchlight will remember it.": "Merci. Porchlight s'en souviendra.", "Yes, it's ours": "Oui, il est à nous", "I don't know it": "Je ne le connais pas",
    // removing a device
    "How to remove it": "Comment le retirer", "Remove a device from your network": "Retirer un appareil de votre réseau",
    "Porchlight never logs in to your router or attacks devices, so it can't push anything off by itself. These two ways work:": "Porchlight ne se connecte jamais à votre routeur et n'attaque jamais d'appareil : il ne peut donc rien expulser lui-même. Ces deux méthodes marchent :",
    "Change your Wi-Fi password (the sure way)": "Changer le mot de passe Wi-Fi (la méthode sûre)",
    "Open your router's settings page at {url} and log in.": "Ouvrez la page de réglages de votre routeur à l'adresse {url} et connectez-vous.",
    "Open your router's settings page and log in.": "Ouvrez la page de réglages de votre routeur et connectez-vous.",
    "Go to Wi-Fi (or Wireless) → Security, and set a new password of 12 characters or more. Keep WPA2 or WPA3.": "Allez dans Wi-Fi (ou Sans fil) → Sécurité, et choisissez un nouveau mot de passe de 12 caractères ou plus. Gardez WPA2 ou WPA3.",
    "Reconnect your own devices with the new password. Everyone else is out.": "Reconnectez vos appareils avec le nouveau mot de passe. Tous les autres sont dehors.",
    "Or block just this device": "Ou bloquer seulement cet appareil",
    "In the router's settings, find \"Connected devices\", \"Access control\" or \"MAC filter\".": "Dans les réglages du routeur, cherchez « Appareils connectés », « Contrôle d'accès » ou « Filtrage MAC ».",
    "Find the device with hardware address {mac} ({ip}) and choose Block.": "Trouvez l'appareil d'adresse matérielle {mac} ({ip}) et choisissez Bloquer.",
    "Some phones change their hardware address, so a block may not last. Changing the password always works.": "Certains téléphones changent d'adresse matérielle : un blocage peut donc ne pas durer. Changer le mot de passe marche toujours.",
    "Porchlight will tell you if it comes back.": "Porchlight vous dira s'il revient.",
    "Then someone may know your Wi-Fi password. It could also be a visitor's phone, or a gadget you forgot about, like a smart plug.": "Alors quelqu'un connaît peut-être votre mot de passe Wi-Fi. Ce peut aussi être le téléphone d'un visiteur, ou un gadget oublié, comme une prise connectée.",
    // who's here
    "Everything connected to your home network. Give anything a name you'll recognise.": "Tout ce qui est connecté à votre réseau. Donnez à chaque appareil un nom que vous reconnaîtrez.",
    "Show": "Afficher", "Here now": "Présents", "Everyone seen": "Tous ceux vus",
    "Phones and tablets": "Téléphones et tablettes", "Computers": "Ordinateurs", "TV, cameras and home": "TV, caméras et maison", "Not sure yet": "Pas encore sûr",
    "Last seen {when}": "Vu {when}", "New": "Nouveau", "Port {p}": "Port {p}", "Show me how": "Montrez-moi comment",
    "It doesn't announce a name (many phones hide theirs). Give it one and Porchlight will remember it.": "Il n'annonce pas de nom (beaucoup de téléphones cachent le leur). Donnez-lui-en un et Porchlight s'en souviendra.",
    "Open to the network:": "Ouvert sur le réseau :", "Name it": "Le nommer", "Rename": "Renommer", "It's ours": "Il est à nous", "Forget it": "L'oublier",
    "No devices yet. The first look takes about a minute.": "Pas encore d'appareils. Le premier coup d'œil prend environ une minute.",
    "{name}: open Who's here": "{name} : ouvrir Qui est là", "{n} more devices": "{n} autres appareils", "your router": "votre routeur", "Router": "Routeur",
    "Map of your home: {count} around your router. Use the arrow keys to move between them.": "Carte de votre maison : {count} autour de votre routeur. Utilisez les flèches pour passer de l'un à l'autre.",
    "{count} here now": "{count} présents", ", {n} through your extender": ", dont {n} par votre répéteur",
    // ports
    "FTP file sharing": "Partage de fichiers FTP", "Settings page": "Page de réglages", "Settings page (secure)": "Page de réglages (sécurisée)", "Windows file sharing": "Partage de fichiers Windows",
    "Video stream": "Flux vidéo", "Smart-home messages": "Messages domotiques", "Remote Desktop": "Bureau à distance", "Android debugging": "Débogage Android", "Screen sharing (VNC)": "Partage d'écran (VNC)", "Web page": "Page web",
    // wi-fi
    "How your Wi-Fi is locked, whether anything nearby pretends to be it, and which networks this computer joins on its own.": "Comment votre Wi-Fi est verrouillé, si quelque chose à proximité se fait passer pour lui, et quels réseaux cet ordinateur rejoint tout seul.",
    "Around this computer": "Autour de cet ordinateur", "To fix": "À corriger",
    "A second network from your router": "Un second réseau de votre routeur", "Your extender's network": "Le réseau de votre répéteur",
    "Password lock": "Verrou par mot de passe", "Keeps strangers off your Wi-Fi.": "Garde les inconnus hors de votre Wi-Fi.", "Weak ({p})": "Faible ({p})", "Strong ({p})": "Solide ({p})",
    "Protection from fake disconnects": "Protection contre les fausses déconnexions", "Stops someone nearby kicking your devices off the Wi-Fi (PMF).": "Empêche quelqu'un à proximité d'éjecter vos appareils du Wi-Fi (PMF).",
    "PIN pairing (WPS)": "Appairage par code PIN (WPS)", "An old way to join with an 8-digit PIN that can be guessed on some models.": "Une ancienne façon de se connecter avec un code à 8 chiffres, devinable sur certains modèles.",
    "Your Wi-Fi wasn't heard on the last check.": "Votre Wi-Fi n'a pas été entendu lors de la dernière vérification.", "Choose your Wi-Fi in Settings so Porchlight can watch it.": "Choisissez votre Wi-Fi dans les Réglages pour que Porchlight puisse le surveiller.",
    "Using your Wi-Fi's name: {list}. Don't connect to them.": "Utilisent le nom de votre Wi-Fi : {list}. Ne vous y connectez pas.", "Nothing nearby is using your Wi-Fi's name.": "Rien à proximité n'utilise le nom de votre Wi-Fi.",
    "Networks this computer joins by itself": "Réseaux que cet ordinateur rejoint tout seul",
    "Open networks it would join without asking: {list}. Fake hotspots use exactly this.": "Réseaux ouverts qu'il rejoindrait sans demander : {list}. Les faux points d'accès utilisent justement cela.",
    "{n} saved, none of them open. Fake hotspots can't lure it.": "{n} enregistrés, aucun ouvert. Les faux points d'accès ne peuvent pas l'attirer.", "Safe": "Sûr",
    "Kick-off watch": "Surveillance des éjections", "Listening live: Porchlight warns you the moment this computer is pushed off the Wi-Fi again and again.": "Écoute en direct : Porchlight vous prévient dès que cet ordinateur est éjecté du Wi-Fi à répétition.",
    "Not available on this computer (no Wi-Fi adapter, or Windows didn't allow it). Regular checks still run.": "Indisponible sur cet ordinateur (pas d'adaptateur Wi-Fi, ou Windows ne l'a pas permis). Les vérifications régulières continuent.",
    "Wi-Fi adapter": "Adaptateur Wi-Fi", ", connected to \"{name}\"": ", connecté à « {name} »", ", not connected": ", non connecté", "Working": "Fonctionne",
    // history
    "Everything Porchlight noticed, newest first.": "Tout ce que Porchlight a remarqué, du plus récent au plus ancien.", "Mark all as read": "Tout marquer comme lu",
    "Nothing yet. Porchlight will note here everything it notices.": "Rien pour l'instant. Porchlight notera ici tout ce qu'il remarque.", "Today": "Aujourd'hui", "Yesterday": "Hier",
    // settings
    "Porchlight works out of the box. Change anything you like.": "Porchlight marche tel quel. Changez ce que vous voulez.",
    "Start with Windows": "Démarrer avec Windows", "Keep watching after you restart, quietly in the tray.": "Continuer de veiller après un redémarrage, discrètement dans la zone de notification.",
    "Notifications": "Notifications", "When someone new joins, something pretends to be your router, a fake copy of your Wi-Fi appears, or a new problem shows up.": "Quand quelqu'un de nouveau arrive, que quelque chose se fait passer pour votre routeur, qu'une fausse copie de votre Wi-Fi apparaît, ou qu'un nouveau problème surgit.",
    "Look around every": "Regarder toutes les", "A quick look at who's here and what your Wi-Fi looks like. A full checkup runs once a day, and whenever you press Check now.": "Un rapide coup d'œil à qui est là et à votre Wi-Fi. Une vérification complète a lieu une fois par jour, et chaque fois que vous appuyez sur Vérifier maintenant.",
    "5 minutes": "5 minutes", "10 minutes": "10 minutes", "15 minutes": "15 minutes", "30 minutes": "30 minutes", "hour": "heures",
    "The network Porchlight protects from fake copies.": "Le réseau que Porchlight protège des fausses copies.",
    "Language": "Langue", "Porchlight's words, alerts and advice.": "Les mots, alertes et conseils de Porchlight.", "Same as Windows": "Comme Windows",
    "Replaced your router?": "Routeur remplacé ?", "Tell Porchlight the new one is yours, so it stops warning about its identity.": "Dites à Porchlight que le nouveau est à vous, pour qu'il cesse d'alerter sur son identité.",
    "I replaced my router": "J'ai remplacé mon routeur", "Moved, or changed network?": "Déménagé, ou changé de réseau ?", "Make the network you're on now your home network.": "Faire du réseau actuel votre réseau domestique.", "Watch this network": "Surveiller ce réseau",
    "Updates": "Mises à jour", "Porchlight is up to date": "Porchlight est à jour", "Porchlight checks once a day. Updates are signed, and only installed when you choose.": "Porchlight vérifie une fois par jour. Les mises à jour sont signées, et installées seulement quand vous le décidez.",
    "Check for updates": "Rechercher des mises à jour", "Porchlight {v} is ready": "Porchlight {v} est prêt", "Porchlight {v} is up to date": "Porchlight {v} est à jour",
    "Help": "Aide", "Something wrong or confusing?": "Quelque chose ne va pas ou n'est pas clair ?",
    "Tell us on GitHub. Attach a diagnostic file: it has counts and check names, never device names, network names or addresses.": "Dites-le-nous sur GitHub. Joignez un fichier de diagnostic : il contient des nombres et des noms de vérifications, jamais de noms d'appareils, de réseaux ni d'adresses.",
    "Save diagnostic file": "Enregistrer le fichier de diagnostic", "Report a problem": "Signaler un problème",
    "Privacy": "Confidentialité", "What Porchlight sends, and to whom": "Ce que Porchlight envoie, et à qui",
    "Nothing about you or your devices. One daily update check, and one test lookup for a made-up name during full checkups. Everything else stays on this computer.": "Rien sur vous ni sur vos appareils. Une recherche de mise à jour par jour, et une recherche test d'un nom inventé lors des vérifications complètes. Tout le reste reste sur cet ordinateur.",
    "Read the privacy notes": "Lire les notes de confidentialité", "Forget everything": "Tout oublier", "Delete every device, name and alert, and stop starting with Windows.": "Supprimer chaque appareil, nom et alerte, et ne plus démarrer avec Windows.",
    "Free and open source (MIT). It looks; it never breaks in. Only watch networks you're allowed to watch.": "Libre et open source (MIT). Il regarde ; il n'entre jamais par effraction. Ne surveillez que les réseaux que vous avez le droit de surveiller.",
    "Okay. Porchlight will learn your new router on the next check.": "D'accord. Porchlight apprendra votre nouveau routeur à la prochaine vérification.",
    "Click again to delete everything": "Cliquez encore pour tout supprimer", "Installing…": "Installation…",
    "A signed update is ready. Install it whenever you like.": "Une mise à jour signée est prête. Installez-la quand vous voulez.", "You have the latest version. Porchlight checks again tomorrow.": "Vous avez la dernière version. Porchlight vérifiera de nouveau demain.",
    "Saved to {path}. Attach it to your report.": "Enregistré dans {path}. Joignez-le à votre signalement.", "Couldn't save the file: {e}": "Impossible d'enregistrer le fichier : {e}",
    "Fixed: {title}.": "Corrigé : {title}.", "{count} left.": "Reste : {count}.", "That was the last one.": "C'était la dernière.",
    // time
    "never": "jamais", "just now": "à l'instant", "{n} min ago": "il y a {n} min", "{n} h ago": "il y a {n} h", "yesterday": "hier", "{n} days ago": "il y a {n} jours",
  },
  ar: {
    "Skip to content": "انتقل إلى المحتوى", "Minimize": "تصغير", "Maximize": "تكبير", "Close to tray": "إغلاق إلى شريط المهام",
    "Turn the light on your home network.": "أضئ النور على شبكة منزلك.",
    "A calm guard for your home": "حارس هادئ لمنزلك",
    "Porchlight sits quietly in your tray and tells you, in plain words, when something changes at home: someone new joins your Wi-Fi, something pretends to be your router, or a setting leaves a door open.":
      "يبقى Porchlight بهدوء في شريط المهام ويخبرك بكلمات بسيطة عندما يتغير شيء في المنزل: شخص جديد ينضم إلى شبكتك، أو شيء ينتحل صفة الراوتر، أو إعداد يترك باباً مفتوحاً.",
    "It only looks.": "إنه ينظر فقط.", "No logins, no password guessing, nothing that could disturb your devices.": "لا تسجيل دخول، ولا تخمين لكلمات المرور، ولا شيء قد يزعج أجهزتك.",
    "It stays on this computer.": "يبقى على هذا الحاسوب.", "No account, no cloud. Delete everything with one button.": "لا حساب ولا سحابة. احذف كل شيء بزر واحد.",
    "It tells you what to do,": "يخبرك بما عليك فعله،", "one step at a time, and checks that the fix worked.": "خطوة بخطوة، ويتحقق من نجاح الإصلاح.",
    "Your network": "شبكتك", "Your router": "الراوتر", "Your Wi-Fi": "شبكة الواي فاي",
    "So Porchlight can spot fake copies of it. It never asks for your Wi-Fi password.": "حتى يكتشف Porchlight النسخ المزيفة منها. لا يطلب أبداً كلمة مرور الواي فاي.",
    "This is my network and I'm allowed to watch it.": "هذه شبكتي ويحق لي مراقبتها.",
    "Turn the light on": "أضئ النور", "Not connected": "غير متصل", "Choose your Wi-Fi…": "اختر شبكتك…", "No Wi-Fi adapter (skip)": "لا يوجد محوّل واي فاي (تخطَّ)", " (connected)": " (متصل)",
    "Sections": "الأقسام", "Home": "الرئيسية", "Who's here": "من هنا", "Wi-Fi": "الواي فاي", "History": "السجل", "Settings": "الإعدادات",
    "Starting…": "جارٍ البدء…", "Install update": "ثبّت التحديث", "Check now": "افحص الآن", "Checking…": "جارٍ الفحص…",
    "Paused": "متوقف مؤقتاً", "Watching quietly": "يراقب بهدوء", "Away from home": "خارج المنزل", "Checked {when}": "فُحص {when}",
    "Porchlight {v} is ready: newer checks and fixes.": "Porchlight {v} جاهز: فحوص وإصلاحات أحدث.",
    "Taking a first look…": "نظرة أولى…", "Someone new joined your network": "شخص جديد انضم إلى شبكتك",
    "What Porchlight keeps watch over": "ما يراقبه Porchlight", "Also on your list": "أيضاً في قائمتك", "Good to know": "من المفيد معرفته",
    "You said these are fine": "قلت إن هذه لا بأس بها", "Your home at a glance": "منزلك في لمحة",
    "Your home tonight": "منزلك الليلة", "Your home this morning": "منزلك هذا الصباح", "Your home this afternoon": "منزلك بعد الظهر", "Your home this evening": "منزلك هذا المساء",
    "Map of your home network": "خريطة شبكة منزلك", "Fix soon": "أصلحه قريباً", "Worth fixing": "يستحق الإصلاح", "Through your extender": "عبر المقوّي",
    "Lately": "مؤخراً", "All history": "كل السجل",
    "This takes about a minute. You can close the window: Porchlight keeps going in the tray.": "يستغرق ذلك نحو دقيقة. يمكنك إغلاق النافذة: يواصل Porchlight العمل في شريط المهام.",
    "You're away from home.": "أنت خارج المنزل.",
    "Porchlight watches your home network and picks up again when you're back. It still watches the Wi-Fi around you here.": "يراقب Porchlight شبكة منزلك ويستأنف عند عودتك. ولا يزال يراقب الواي فاي من حولك هنا.",
    "Someone you don't recognise is on your Wi-Fi.": "شخص لا تعرفه على شبكتك.",
    "{count} you don't recognise are on your Wi-Fi.": "{count} لا تعرفها على شبكتك.",
    "Changing your Wi-Fi password sends them away. The steps are below.": "تغيير كلمة مرور الواي فاي يبعدهم. الخطوات في الأسفل.",
    "All quiet at home.": "كل شيء هادئ في المنزل.", "{count} here, and nothing needs you. Porchlight keeps watching from the tray.": "{count} هنا، ولا شيء يحتاجك. يواصل Porchlight المراقبة من شريط المهام.",
    "One thing should be fixed soon.": "أمر واحد يجب إصلاحه قريباً.", "{count} should be fixed soon.": "{count} يجب إصلاحها قريباً.",
    "Your home is mostly safe.": "منزلك آمن في الغالب.", "Someone new joined your network.": "شخص جديد انضم إلى شبكتك.",
    "{count} joined your network.": "انضم إلى شبكتك {count}.", "Tell Porchlight whether you know them.": "أخبر Porchlight إن كنت تعرفها.",
    "{count} to do": "{count} للقيام بها", ", and someone new to check": "، وجهاز جديد للتحقق منه", ". The next one takes about {n} minutes.": ". التالي يستغرق نحو {n} دقائق.",
    "Checking now": "جارٍ الفحص", "checked {when}": "فُحص {when}", "first look": "النظرة الأولى",
    "part:morning": "صباحاً", "part:afternoon": "بعد الظهر", "part:evening": "مساءً", "part:night": "ليلاً",
    "Next step · about {n} minutes": "الخطوة التالية · نحو {n} دقائق",
    "Who joins your Wi-Fi": "من ينضم إلى شبكتك", "You'll hear about anyone new within a few minutes.": "ستعرف بأي جهاز جديد خلال دقائق.", "Watching": "تحت المراقبة",
    "Something pretending to be your router is caught as it happens.": "أي شيء ينتحل صفة الراوتر يُكشف لحظة حدوثه.",
    "Fake copies of your Wi-Fi": "نسخ مزيفة من شبكتك", "Something nearby uses your Wi-Fi's name. See Wi-Fi.": "شيء قريب يستخدم اسم شبكتك. راجع الواي فاي.",
    "Nothing nearby uses your Wi-Fi's name.": "لا شيء قريب يستخدم اسم شبكتك.", "{n} nearby": "{n} قريبة", "None": "لا شيء",
    "Being kicked off the Wi-Fi": "الطرد من الواي فاي", "Listened for live, between checks.": "مراقبة مباشرة بين الفحوص.", "Listening": "يستمع", "Off": "متوقف", "On": "مفعّل",
    "Your DNS": "خادم DNS", "If the address book your computer uses for websites changes, you'll know.": "إن تغيّر دليل العناوين الذي يستخدمه حاسوبك للمواقع، ستعرف.",
    "Not recognised": "غير معروف", "Someone new joined your network. Is it yours?": "شخص جديد انضم إلى شبكتك. هل هو لك؟", "Some new devices joined. Are they yours?": "انضمت أجهزة جديدة. هل هي لك؟",
    "Nothing has happened yet.": "لم يحدث شيء بعد.", " (new)": " (جديد)",
    "On your router": "على الراوتر", "On {name}": "على {name}", "On this computer": "على هذا الحاسوب", "In your network settings": "في إعدادات الشبكة",
    "Undo": "تراجع", "Okay. Porchlight won't bring this up again.": "حسناً. لن يذكر Porchlight هذا مرة أخرى.",
    "It's still there. Some devices only apply a change after a restart: restart it, wait a minute, then check again.": "لا يزال موجوداً. بعض الأجهزة لا تطبّق التغيير إلا بعد إعادة التشغيل: أعد تشغيله، وانتظر دقيقة، ثم افحص مجدداً.",
    "Checking your home again. This takes about a minute.": "جارٍ فحص منزلك مجدداً. يستغرق ذلك نحو دقيقة.",
    "What Porchlight saw": "ما رآه Porchlight", "How likely it matters: {x}": "مدى الخطورة: {x}", "I did it, check again": "فعلت ذلك، افحص مجدداً",
    "Show me another": "أرني غيره", "Do this one next": "افعل هذا تالياً", "It's fine, stop telling me": "لا بأس، توقف عن إخباري",
    "{n} min": "{n} د", "Put it back on my list": "أعده إلى قائمتي", "Got it, hide this": "فهمت، أخفِ هذا",
    "Offline": "غير متصل", "No problems found": "لا مشاكل",
    "Saved. Porchlight will call it \"{name}\".": "حُفظ. سيسمّيه Porchlight \"{name}\".", "For example: Mum's phone": "مثلاً: هاتف أمي", "Name for {name}": "اسم لـ {name}", "Save": "احفظ", "Skip": "تخطَّ",
    "you didn't recognise it": "لم تتعرف عليه", "joined {when}": "انضم {when}", "through your extender": "عبر المقوّي",
    "Actually, it's ours": "في الواقع، إنه لنا", "Thanks. Porchlight will remember it.": "شكراً. سيتذكره Porchlight.", "Yes, it's ours": "نعم، إنه لنا", "I don't know it": "لا أعرفه",
    "How to remove it": "كيف تزيله", "Remove a device from your network": "إزالة جهاز من شبكتك",
    "Porchlight never logs in to your router or attacks devices, so it can't push anything off by itself. These two ways work:": "لا يسجّل Porchlight الدخول إلى الراوتر ولا يهاجم الأجهزة، لذا لا يستطيع طرد أي شيء بنفسه. هاتان الطريقتان تنجحان:",
    "Change your Wi-Fi password (the sure way)": "غيّر كلمة مرور الواي فاي (الطريقة الأكيدة)",
    "Open your router's settings page at {url} and log in.": "افتح صفحة إعدادات الراوتر على {url} وسجّل الدخول.",
    "Open your router's settings page and log in.": "افتح صفحة إعدادات الراوتر وسجّل الدخول.",
    "Go to Wi-Fi (or Wireless) → Security, and set a new password of 12 characters or more. Keep WPA2 or WPA3.": "اذهب إلى Wi-Fi (أو Wireless) ← الأمان، وضع كلمة مرور جديدة من 12 حرفاً أو أكثر. أبقِ WPA2 أو WPA3.",
    "Reconnect your own devices with the new password. Everyone else is out.": "أعد توصيل أجهزتك بكلمة المرور الجديدة. الجميع غيرك خارج الشبكة.",
    "Or block just this device": "أو احظر هذا الجهاز فقط",
    "In the router's settings, find \"Connected devices\", \"Access control\" or \"MAC filter\".": "في إعدادات الراوتر، ابحث عن \"الأجهزة المتصلة\" أو \"التحكم بالوصول\" أو \"تصفية MAC\".",
    "Find the device with hardware address {mac} ({ip}) and choose Block.": "ابحث عن الجهاز ذي العنوان المادي {mac} ({ip}) واختر حظر.",
    "Some phones change their hardware address, so a block may not last. Changing the password always works.": "بعض الهواتف تغيّر عنوانها المادي، لذا قد لا يدوم الحظر. تغيير كلمة المرور ينجح دائماً.",
    "Porchlight will tell you if it comes back.": "سيخبرك Porchlight إن عاد.",
    "Then someone may know your Wi-Fi password. It could also be a visitor's phone, or a gadget you forgot about, like a smart plug.": "إذن ربما يعرف أحدهم كلمة مرور الواي فاي. وقد يكون أيضاً هاتف زائر، أو جهازاً نسيته، مثل قابس ذكي.",
    "Everything connected to your home network. Give anything a name you'll recognise.": "كل ما هو متصل بشبكة منزلك. أعطِ كل جهاز اسماً تعرفه.",
    "Show": "عرض", "Here now": "هنا الآن", "Everyone seen": "كل من ظهر",
    "Phones and tablets": "الهواتف والألواح", "Computers": "الحواسيب", "TV, cameras and home": "التلفاز والكاميرات والمنزل", "Not sure yet": "غير مؤكد بعد",
    "Last seen {when}": "آخر ظهور {when}", "New": "جديد", "Port {p}": "المنفذ {p}", "Show me how": "أرني كيف",
    "It doesn't announce a name (many phones hide theirs). Give it one and Porchlight will remember it.": "لا يعلن عن اسمه (كثير من الهواتف تخفي أسماءها). أعطه اسماً وسيتذكره Porchlight.",
    "Open to the network:": "مفتوح على الشبكة:", "Name it": "سمّه", "Rename": "أعد التسمية", "It's ours": "إنه لنا", "Forget it": "انسه",
    "No devices yet. The first look takes about a minute.": "لا أجهزة بعد. النظرة الأولى تستغرق نحو دقيقة.",
    "{name}: open Who's here": "{name}: افتح من هنا", "{n} more devices": "{n} أجهزة أخرى", "your router": "الراوتر", "Router": "الراوتر",
    "Map of your home: {count} around your router. Use the arrow keys to move between them.": "خريطة منزلك: {count} حول الراوتر. استخدم مفاتيح الأسهم للتنقل بينها.",
    "{count} here now": "{count} هنا الآن", ", {n} through your extender": "، منها {n} عبر المقوّي",
    "FTP file sharing": "مشاركة ملفات FTP", "Settings page": "صفحة الإعدادات", "Settings page (secure)": "صفحة الإعدادات (آمنة)", "Windows file sharing": "مشاركة ملفات Windows",
    "Video stream": "بث فيديو", "Smart-home messages": "رسائل المنزل الذكي", "Remote Desktop": "سطح المكتب البعيد", "Android debugging": "تصحيح Android", "Screen sharing (VNC)": "مشاركة الشاشة (VNC)", "Web page": "صفحة ويب",
    "How your Wi-Fi is locked, whether anything nearby pretends to be it, and which networks this computer joins on its own.": "كيف تُقفل شبكتك، وهل يوجد قربك ما ينتحل صفتها، وأي الشبكات ينضم إليها هذا الحاسوب تلقائياً.",
    "Around this computer": "حول هذا الحاسوب", "To fix": "للإصلاح",
    "A second network from your router": "شبكة ثانية من الراوتر", "Your extender's network": "شبكة المقوّي",
    "Password lock": "القفل بكلمة مرور", "Keeps strangers off your Wi-Fi.": "يبقي الغرباء خارج شبكتك.", "Weak ({p})": "ضعيف ({p})", "Strong ({p})": "قوي ({p})",
    "Protection from fake disconnects": "الحماية من قطع الاتصال المزيف", "Stops someone nearby kicking your devices off the Wi-Fi (PMF).": "يمنع شخصاً قريباً من طرد أجهزتك من الواي فاي (PMF).",
    "PIN pairing (WPS)": "الاقتران برمز PIN (WPS)", "An old way to join with an 8-digit PIN that can be guessed on some models.": "طريقة قديمة للانضمام برمز من 8 أرقام يمكن تخمينه في بعض الطرازات.",
    "Your Wi-Fi wasn't heard on the last check.": "لم تُسمع شبكتك في الفحص الأخير.", "Choose your Wi-Fi in Settings so Porchlight can watch it.": "اختر شبكتك في الإعدادات حتى يراقبها Porchlight.",
    "Using your Wi-Fi's name: {list}. Don't connect to them.": "تستخدم اسم شبكتك: {list}. لا تتصل بها.", "Nothing nearby is using your Wi-Fi's name.": "لا شيء قريب يستخدم اسم شبكتك.",
    "Networks this computer joins by itself": "شبكات ينضم إليها هذا الحاسوب تلقائياً",
    "Open networks it would join without asking: {list}. Fake hotspots use exactly this.": "شبكات مفتوحة سينضم إليها دون سؤال: {list}. نقاط الاتصال المزيفة تستغل هذا تحديداً.",
    "{n} saved, none of them open. Fake hotspots can't lure it.": "{n} محفوظة، ولا واحدة منها مفتوحة. لا تستطيع نقاط الاتصال المزيفة استدراجه.", "Safe": "آمن",
    "Kick-off watch": "مراقبة الطرد", "Listening live: Porchlight warns you the moment this computer is pushed off the Wi-Fi again and again.": "استماع مباشر: يحذرك Porchlight لحظة طرد هذا الحاسوب من الواي فاي مراراً.",
    "Not available on this computer (no Wi-Fi adapter, or Windows didn't allow it). Regular checks still run.": "غير متاح على هذا الحاسوب (لا يوجد محوّل واي فاي، أو لم يسمح Windows بذلك). الفحوص المنتظمة مستمرة.",
    "Wi-Fi adapter": "محوّل الواي فاي", ", connected to \"{name}\"": "، متصل بـ \"{name}\"", ", not connected": "، غير متصل", "Working": "يعمل",
    "Everything Porchlight noticed, newest first.": "كل ما لاحظه Porchlight، الأحدث أولاً.", "Mark all as read": "علّم الكل كمقروء",
    "Nothing yet. Porchlight will note here everything it notices.": "لا شيء بعد. سيدوّن Porchlight هنا كل ما يلاحظه.", "Today": "اليوم", "Yesterday": "أمس",
    "Porchlight works out of the box. Change anything you like.": "يعمل Porchlight مباشرة. غيّر ما تشاء.",
    "Start with Windows": "التشغيل مع Windows", "Keep watching after you restart, quietly in the tray.": "واصل المراقبة بعد إعادة التشغيل، بهدوء في شريط المهام.",
    "Notifications": "الإشعارات", "When someone new joins, something pretends to be your router, a fake copy of your Wi-Fi appears, or a new problem shows up.": "عندما ينضم جهاز جديد، أو ينتحل شيء صفة الراوتر، أو تظهر نسخة مزيفة من شبكتك، أو تظهر مشكلة جديدة.",
    "Look around every": "افحص كل", "A quick look at who's here and what your Wi-Fi looks like. A full checkup runs once a day, and whenever you press Check now.": "نظرة سريعة على من هنا وعلى حال شبكتك. يجري فحص كامل مرة يومياً، وكلما ضغطت افحص الآن.",
    "5 minutes": "5 دقائق", "10 minutes": "10 دقائق", "15 minutes": "15 دقيقة", "30 minutes": "30 دقيقة", "hour": "ساعة",
    "The network Porchlight protects from fake copies.": "الشبكة التي يحميها Porchlight من النسخ المزيفة.",
    "Language": "اللغة", "Porchlight's words, alerts and advice.": "كلمات Porchlight وتنبيهاته ونصائحه.", "Same as Windows": "مثل Windows",
    "Replaced your router?": "استبدلت الراوتر؟", "Tell Porchlight the new one is yours, so it stops warning about its identity.": "أخبر Porchlight أن الجديد لك، حتى يتوقف عن التحذير من هويته.",
    "I replaced my router": "استبدلت الراوتر", "Moved, or changed network?": "انتقلت أو غيّرت الشبكة؟", "Make the network you're on now your home network.": "اجعل الشبكة الحالية شبكة منزلك.", "Watch this network": "راقب هذه الشبكة",
    "Updates": "التحديثات", "Porchlight is up to date": "Porchlight محدّث", "Porchlight checks once a day. Updates are signed, and only installed when you choose.": "يتحقق Porchlight مرة يومياً. التحديثات موقّعة، ولا تُثبَّت إلا عندما تختار.",
    "Check for updates": "ابحث عن تحديثات", "Porchlight {v} is ready": "Porchlight {v} جاهز", "Porchlight {v} is up to date": "Porchlight {v} محدّث",
    "Help": "المساعدة", "Something wrong or confusing?": "هل هناك خطأ أو شيء غير واضح؟",
    "Tell us on GitHub. Attach a diagnostic file: it has counts and check names, never device names, network names or addresses.": "أخبرنا على GitHub. أرفق ملف تشخيص: فيه أعداد وأسماء الفحوص، ولا يحتوي أبداً على أسماء أجهزة أو شبكات أو عناوين.",
    "Save diagnostic file": "احفظ ملف التشخيص", "Report a problem": "أبلغ عن مشكلة",
    "Privacy": "الخصوصية", "What Porchlight sends, and to whom": "ما يرسله Porchlight، ولمن",
    "Nothing about you or your devices. One daily update check, and one test lookup for a made-up name during full checkups. Everything else stays on this computer.": "لا شيء عنك أو عن أجهزتك. بحث يومي واحد عن تحديث، وبحث تجريبي واحد عن اسم مختلق أثناء الفحوص الكاملة. كل ما عدا ذلك يبقى على هذا الحاسوب.",
    "Read the privacy notes": "اقرأ ملاحظات الخصوصية", "Forget everything": "انسَ كل شيء", "Delete every device, name and alert, and stop starting with Windows.": "احذف كل جهاز واسم وتنبيه، وأوقف التشغيل مع Windows.",
    "Free and open source (MIT). It looks; it never breaks in. Only watch networks you're allowed to watch.": "مجاني ومفتوح المصدر (MIT). ينظر ولا يقتحم أبداً. لا تراقب إلا الشبكات التي يحق لك مراقبتها.",
    "Okay. Porchlight will learn your new router on the next check.": "حسناً. سيتعرف Porchlight على الراوتر الجديد في الفحص التالي.",
    "Click again to delete everything": "انقر مجدداً لحذف كل شيء", "Installing…": "جارٍ التثبيت…",
    "A signed update is ready. Install it whenever you like.": "تحديث موقّع جاهز. ثبّته متى شئت.", "You have the latest version. Porchlight checks again tomorrow.": "لديك أحدث إصدار. سيتحقق Porchlight مجدداً غداً.",
    "Saved to {path}. Attach it to your report.": "حُفظ في {path}. أرفقه ببلاغك.", "Couldn't save the file: {e}": "تعذّر حفظ الملف: {e}",
    "Fixed: {title}.": "أُصلح: {title}.", "{count} left.": "المتبقي: {count}.", "That was the last one.": "كان هذا الأخير.",
    "never": "أبداً", "just now": "الآن", "{n} min ago": "منذ {n} د", "{n} h ago": "منذ {n} س", "yesterday": "أمس", "{n} days ago": "منذ {n} أيام",
  },
};

// Device kinds stay in English inside Porchlight; this is how they read.
const KINDS = {
  "router": ["routeur", "راوتر"], "this computer": ["cet ordinateur", "هذا الحاسوب"], "camera": ["caméra", "كاميرا"], "Wi-Fi extender": ["répéteur Wi-Fi", "مقوّي واي فاي"],
  "TV or streaming device": ["TV ou boîtier de streaming", "تلفاز أو جهاز بث"], "printer": ["imprimante", "طابعة"], "phone or tablet": ["téléphone ou tablette", "هاتف أو لوحي"],
  "smart-home device": ["appareil connecté", "جهاز منزل ذكي"], "Apple phone, tablet or computer": ["téléphone, tablette ou ordinateur Apple", "هاتف أو لوحي أو حاسوب من Apple"],
  "computer": ["ordinateur", "حاسوب"], "Windows computer": ["ordinateur Windows", "حاسوب Windows"], "phone, tablet or Mac": ["téléphone, tablette ou Mac", "هاتف أو لوحي أو Mac"],
  "device on your extender": ["appareil sur votre répéteur", "جهاز على المقوّي"], "phone, tablet or laptop": ["téléphone, tablette ou portable", "هاتف أو لوحي أو حاسوب محمول"], "device": ["appareil", "جهاز"],
};
const kindLabel = (kind = "") => (LANG === "en" ? kind : KINDS[kind]?.[LANG === "fr" ? 0 : 1] || kind);

function t(en, vars) {
  let s = DICT[LANG]?.[en] ?? en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// "five devices", "5 appareils", "5 أجهزة": counted nouns in each language.
const EN_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const NOUNS = {
  en: { device: ["device", "devices"], thing: ["thing", "things"], "new device": ["new device", "new devices"] },
  fr: { device: ["aucun appareil", "un appareil", "appareils"], thing: ["rien", "une chose", "choses"], "new device": ["aucun nouvel appareil", "un nouvel appareil", "nouveaux appareils"] },
  // zero, one, two, three to ten, eleven and more
  ar: { device: ["لا أجهزة", "جهاز واحد", "جهازان", "أجهزة", "جهازاً"], thing: ["لا شيء", "أمر واحد", "أمران", "أمور", "أمراً"], "new device": ["لا أجهزة جديدة", "جهاز جديد", "جهازان جديدان", "أجهزة جديدة", "جهازاً جديداً"] },
};
function count(n, what) {
  const f = NOUNS[LANG][what];
  if (LANG === "fr") return n === 0 ? f[0] : n === 1 ? f[1] : `${n} ${f[2]}`;
  if (LANG === "ar") return n === 0 ? f[0] : n === 1 ? f[1] : n === 2 ? f[2] : n <= 10 ? `${n} ${f[3]}` : `${n} ${f[4]}`;
  return `${n <= 10 ? EN_WORDS[n] : n} ${n === 1 ? f[0] : f[1]}`;
}

// The page's own words (index.html): remembered in English once, then shown in the chosen language.
const ORIGINAL = new WeakMap();
const ATTRS = ["aria-label", "placeholder", "title"];
function rememberPage() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim()) ORIGINAL.set(n, n.nodeValue);
  for (const e of document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) ORIGINAL.set(e, Object.fromEntries(ATTRS.filter((a) => e.hasAttribute(a)).map((a) => [a, e.getAttribute(a)])));
}
function setLang(code) {
  LANG = DICT[code] || code === "en" ? code : "en";
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const en = ORIGINAL.get(n);
    if (en != null) n.nodeValue = en.replace(en.trim(), t(en.trim()));
  }
  for (const e of document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) {
    const o = ORIGINAL.get(e);
    if (o) for (const [a, v] of Object.entries(o)) e.setAttribute(a, t(v));
  }
}
rememberPage();
