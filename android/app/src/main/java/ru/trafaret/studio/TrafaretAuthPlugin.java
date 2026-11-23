package ru.trafaret.studio;

import android.content.Intent;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Плагин Capacitor: реализует для WebView контракт window.trafaretNative.auth.
 * OAuth идёт только нативно (Play Services), WebView для входа не используется.
 */
@CapacitorPlugin(name = "TrafaretAuth")
public class TrafaretAuthPlugin extends Plugin {
    private TrafaretAuthService service;

    @Override
    public void load() {
        service = new TrafaretAuthService(getContext());
        service.setStateListener(signedIn -> {
            JSObject event = new JSObject();
            event.put("signedIn", signedIn);
            notifyListeners("authChanged", event);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (service != null) {
            service.shutdown();
        }
    }

    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", service.isConfigured());
        call.resolve(result);
    }

    @PluginMethod
    public void getSessionState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", service.getSessionState());
        call.resolve(result);
    }

    @PluginMethod
    public void getLastError(PluginCall call) {
        JSObject result = new JSObject();
        result.put("error", service.getLastError());
        call.resolve(result);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        if (!service.isConfigured()) {
            call.resolve(signedInResult(false, "Google Play Services недоступны на устройстве"));
            return;
        }
        // Предыдущий вход ещё не завершён: второй signIn отклоняем сразу, чтобы
        // не перезаписывать сохранённый call — иначе его Promise завис бы навсегда.
        if (getSavedCall() != null) {
            call.reject("Вход уже выполняется — дождитесь завершения текущей попытки");
            return;
        }
        saveCall(call);
        startActivityForResult(call, service.signInIntent(), "handleSignInResult");
    }

    @ActivityCallback
    private void handleSignInResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.resolve(signedInResult(false, "Вход отменён"));
            return;
        }
        service.handleSignInResult(result.getData(), new TrafaretAuthService.TokenCallback() {
            @Override
            public void onToken(String token) {
                call.resolve(signedInResult(true, null));
            }

            @Override
            public void onError(String message, boolean recoverable) {
                call.resolve(signedInResult(false, message));
            }
        });
    }

    @PluginMethod
    public void getAccessToken(PluginCall call) {
        String[] scopes;
        try {
            scopes = call.getArray("scopes", new com.getcapacitor.JSArray()).toList().toArray(new String[0]);
        } catch (org.json.JSONException error) {
            call.reject("Некорректный массив scopes: " + error.getMessage());
            return;
        }
        boolean supported = false;
        for (String scope : scopes) {
            if (TrafaretAuthService.DRIVE_FILE_SCOPE.equals(scope)) {
                supported = true;
                break;
            }
        }
        if (!supported) {
            call.reject("Неподдерживаемый scope: " + String.join(" ", scopes));
            return;
        }
        service.getAccessToken(new TrafaretAuthService.TokenCallback() {
            @Override
            public void onToken(String token) {
                JSObject result = new JSObject();
                result.put("token", token);
                call.resolve(result);
            }

            @Override
            public void onError(String message, boolean recoverable) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        service.signOut(() -> call.resolve(new JSObject()));
    }

    private JSObject signedInResult(boolean signedIn, String error) {
        if (error != null) {
            serviceErrorNote(error);
        }
        JSObject result = new JSObject();
        result.put("signedIn", signedIn);
        return result;
    }

    /** Ошибки входа честно прокидываются в getLastError, а не гасятся. */
    private void serviceErrorNote(String error) {
        // TrafaretAuthService фиксирует lastError сам для большинства путей;
        // здесь оставляем hook для случаев отмены/отсутствия Play Services.
        if (service.getLastError() == null) {
            service.setExternalError(error);
        }
    }
}
