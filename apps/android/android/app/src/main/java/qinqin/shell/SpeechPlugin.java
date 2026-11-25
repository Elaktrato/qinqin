package qinqin.shell;

import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The "device voice": Android's own TextToSpeech engine (the WebView's speechSynthesis is unreliable). No
 * dependency; whichever engine the person installed answers. The web app asks per language whether a voice
 * exists (zh-CN, zh-TW, ja-JP ...) and speaks with that language's voice at a rate.
 */
@CapacitorPlugin(name = "QinqinSpeech")
public class SpeechPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready;
    private boolean failed;
    private final List<Runnable> waiting = new ArrayList<>();
    /** The speak() calls still talking, by utterance id; resolved when the speech ends or is interrupted. */
    private final Map<String, PluginCall> speaking = new ConcurrentHashMap<>();
    private int counter;

    @Override
    public void load() {
        // Lazily: starting an engine costs time and memory that most sessions never need.
    }

    /** Runs `then` once the engine is up (or failed: the callback gets null). Always on the main thread. */
    private void withEngine(java.util.function.Consumer<TextToSpeech> then) {
        getActivity().runOnUiThread(() -> {
            if (ready) {
                then.accept(tts);
                return;
            }
            if (failed) {
                then.accept(null);
                return;
            }
            waiting.add(() -> then.accept(ready ? tts : null));
            if (tts != null) return;
            tts = new TextToSpeech(getContext().getApplicationContext(), status -> getActivity().runOnUiThread(() -> {
                ready = status == TextToSpeech.SUCCESS;
                failed = !ready;
                if (ready) tts.setOnUtteranceProgressListener(listener);
                List<Runnable> run = new ArrayList<>(waiting);
                waiting.clear();
                for (Runnable r : run) r.run();
            }));
        });
    }

    /** The first candidate locale the engine can speak, or null. */
    private static Locale pick(TextToSpeech engine, String lang) {
        for (String tag : SpeechLangs.candidates(lang)) {
            Locale l = Locale.forLanguageTag(tag);
            int r = engine.isLanguageAvailable(l);
            if (r == TextToSpeech.LANG_AVAILABLE || r == TextToSpeech.LANG_COUNTRY_AVAILABLE
                || r == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE) {
                return l;
            }
        }
        return null;
    }

    /** `{lang}` -> `{available, tag, engine}`: whether a voice for the language is installed. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        String lang = call.getString("lang", "");
        withEngine(engine -> {
            JSObject r = new JSObject();
            if (engine == null) {
                r.put("available", false);
                r.put("engine", false);
            } else {
                Locale l = pick(engine, lang);
                r.put("available", l != null);
                r.put("engine", true);
                if (l != null) r.put("tag", l.toLanguageTag());
            }
            call.resolve(r);
        });
    }

    /** `{text, lang, rate?}`: speaks; resolves `{spoken}` when the speech ends (false: no voice, or interrupted). */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = SpeechLangs.text(call.getString("text", ""));
        String lang = call.getString("lang", "");
        float rate = SpeechLangs.rate(call.getDouble("rate"));
        if (text.isEmpty()) {
            call.reject("nothing to say");
            return;
        }
        withEngine(engine -> {
            Locale l = engine == null ? null : pick(engine, lang);
            if (l == null) {
                call.reject("no voice");
                return;
            }
            // A newer speech replaces the older one: stop() makes the old call resolve through onStop.
            engine.stop();
            engine.setLanguage(l);
            engine.setSpeechRate(rate);
            String id = "q" + (++counter);
            speaking.put(id, call);
            if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
                speaking.remove(id);
                call.reject("speak failed");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (tts != null && ready) tts.stop();
            call.resolve();
        });
    }

    /** Opens the system's text-to-speech settings, where voices are installed. */
    @PluginMethod
    public void openVoiceSettings(PluginCall call) {
        Intent[] tries = {
            new Intent("com.android.settings.TTS_SETTINGS"),
            new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA),
            new Intent(android.provider.Settings.ACTION_SETTINGS)
        };
        for (Intent i : tries) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(i);
                call.resolve();
                return;
            } catch (Exception e) {
                // try the next
            }
        }
        call.reject("no settings screen");
    }

    private final UtteranceProgressListener listener = new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {}

        @Override
        public void onDone(String utteranceId) {
            finish(utteranceId, true);
        }

        @Override
        public void onError(String utteranceId) {
            finish(utteranceId, false);
        }

        @Override
        public void onStop(String utteranceId, boolean interrupted) {
            finish(utteranceId, false);
        }
    };

    private void finish(String id, boolean spoken) {
        PluginCall call = speaking.remove(id);
        if (call == null) return;
        JSObject r = new JSObject();
        r.put("spoken", spoken);
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        ready = false;
    }
}
