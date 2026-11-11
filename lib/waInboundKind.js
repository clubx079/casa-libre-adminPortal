// What kind of message a contact sent us on WhatsApp — the first thing the inbox does with an
// inbound message (admin webhook app/api/relay/webhook, campaign results, the Admin Manager).
// Pure — test/waInboundKind.test.js.
//   button    a quick-reply button tap (SÍ / BAJA / CARTERA / PROYECTO) — the website answers it
//   keyword   the same words typed
//   emoji     a reaction, a sticker, or only emojis
//   ack       "gracias", "ok", "dale" — a real person, nothing to answer
//   auto      an automatic greeting from the other side's business account (a robot): never
//             answered, never counted as a reply
//   greeting  "hola" / "buenas" alone — an opener the assistant can answer
//   media     a photo / audio / document without text
//   question  a real text with a question mark
//   text      any other real text
// real = a person actually wrote (button, keyword, greeting, media, question, text).

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}\s‍️]+$/u;
const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const KEYWORDS = new Set(['si', 'baja', 'cartera', 'proyecto', 'stop', 'no recibir mas', 'no mas mensajes', 'parar', 'cancelar']);
const ACK = /^(ok|oka|okey|okay|dale|listo|perfecto|genial|bien|gracias|muchas gracias|mil gracias|muchisimas gracias|de nada|vale|si gracias|ok gracias|perfecto gracias|listo gracias|dale gracias|entendido|recibido|buenisimo|excelente)( (gracias|ok|dale|listo|perfecto))*$/;
const GREETING = /^(hola|holaa+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hola buenas|hola buen dia|hola buenos dias|hola buenas tardes|hola buenas noches|que tal|hola que tal)$/;

// The wording of automatic business greetings / out-of-office replies (Spanish + a little
// English). Conservative on purpose: a real person's question must never match.
const AUTO = [
  /gracias por (comunicarte|comunicarse|contactar(te|se|nos)?|escribir(nos)?|tu mensaje|su mensaje|ponerte en contacto)/,
  /te (responderemos|contestaremos|estaremos (respondiendo|contestando)|estare contestando)/,
  /(responderemos|contestaremos|atenderemos|lo atenderemos|le atenderemos|nos comunicaremos|te contactaremos|te contactara|lo contactaremos)( a la brevedad| en breve| pronto| lo antes posible| en un momento| a la brevedad posible| en un ratito)?/,
  /(a la brevedad|lo antes posible|en breve te|en breve le|en un ratito|cuando pueda|en cuanto podamos)/,
  /horario de atencion/,
  /mensaje automatico|respuesta automatica|contestador automatico|auto ?respuesta/,
  /fuera de (horario|oficina|linea|servicio)/,
  /(un|nuestro|el) (asesor|agente|representante|ejecutivo|equipo)( comercial)? (te|le|se|lo|la) (contactara|atendera|comunicara|respondera|escribira)/,
  /bienvenid[oa]s? a /,
  /en que (te|le|los|les) podemos ayudar/,
  /estamos para ayudarte|estamos a tu disposicion|estamos atendiendo/,
  /dej[ae]nos tu (mensaje|consulta|nombre|numero)/,
  /thank you for (contacting|your message|reaching out)|we will (get back|reply|respond)/,
];
// An agency's automatic greeting: "👋 ¡Hola! Soy Ignacio Fretes, asesor inmobiliario de RE/MAX…",
// "Abriendo puertas… Te saluda Francisco Mendoza, agente inmobiliario de…", "Te contactaste con
// Estela Riveros de C21", "João Ribeiro agradece seu contato. Como podemos ajudar?" (seen in the live
// inbox, Nov 12). It only counts when the text asks for nothing: an agent who introduces themself AND
// wants to publish / asks how it works is a real person.
const INTRO_ROLE = '(agente|asesor|asesora|asesores|corredor|corredora|broker|realtor|century|remax|re max|c21|inmobiliaria|keller|coldwell)';
const SELF_INTRO = [
  new RegExp(`^(hola[a-z ]{0,25} )?(soy|te habla|le habla|habla) [a-z]+( [a-z]+){0,3}( de| del| de la)? ${INTRO_ROLE}`),
  new RegExp(`(^| )(te|le|les) saluda [a-z]+( [a-z]+){0,3}( de| del| de la)? ${INTRO_ROLE}`),
  /^(hola[a-z ]{0,25} )?(te|se) (contactaste|comunicaste|contacto|comunico) con /,
  /agradece (tu|su|seu|el|o) (contacto|contato|mensaje|mensagem)/,
  /(como|em que) (podemos|posso) (te )?ajudar|obrigad[oa] (pelo|por)/,
];
const INTENT = /\b(publicar|publico|publicacion|publicaciones|me interesa|interesad[oa]|quiero|quisiera|como funciona|cuanto cuesta|cuanto sale|cuanto cobran|registrar|inscribir|subir mis|mis propiedades|tengo propiedades|me gustaria)\b/;
const isAgencyGreeting = (s) => SELF_INTRO.some((re) => re.test(s)) && !INTENT.test(s);

export const isRobotText = (text) => { const s = strip(text); return !!s && (AUTO.some((re) => re.test(s)) || isAgencyGreeting(s)); };

const REAL = new Set(['button', 'keyword', 'greeting', 'media', 'question', 'text']);

// m: a Relay message (direction, type, text, media) or the webhook's data (type, text, button.text).
// secondsAfterOurs: how long after our last outbound message it arrived (a long text within
// seconds is a robot even without the usual wording).
export function inboundKind(m, { secondsAfterOurs = null } = {}) {
  const type = String(m?.type || 'text').toLowerCase();
  const text = String(m?.text ?? m?.button?.text ?? m?.interactive?.title ?? '').trim();
  const decide = (kind) => ({ kind, real: REAL.has(kind), text });
  if (type === 'button' || type === 'interactive') return decide('button');
  if (type === 'reaction' || type === 'sticker') return decide('emoji');
  if (!text) return decide(m?.media || ['image', 'video', 'audio', 'document', 'voice', 'location', 'contacts'].includes(type) ? 'media' : 'emoji');
  if (EMOJI_ONLY.test(text)) return decide('emoji');
  const s = strip(text);
  if (KEYWORDS.has(s)) return decide('keyword');
  if (ACK.test(s)) return decide('ack');
  if (isRobotText(text)) return decide('auto');
  if (secondsAfterOurs != null && secondsAfterOurs >= 0 && secondsAfterOurs < 15 && text.length >= 60) return decide('auto');
  if (GREETING.test(s)) return decide('greeting');
  if (/[?¿]/.test(text)) return decide('question');
  return decide('text');
}

export const isRealReply = (m, opts) => inboundKind(m, opts).real;
