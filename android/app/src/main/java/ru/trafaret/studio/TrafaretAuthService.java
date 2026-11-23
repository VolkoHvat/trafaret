package ru.trafaret.studio;

import android.accounts.Account;
import android.content.Context;
import android.content.Intent;

import androidx.annotation.NonNull;

import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Нативная OAuth-сессия «Трафарета» для Android.
 *
 * OAuth выполняется через Google Sign-In (Play Services) + GoogleAuthUtil:
 * приложение идентифицируется подписью сборки, поэтому никакой Client ID
 * и секретов в коде нет. Токены не пишутся на диск — GoogleAuthUtil сам
 * обновляет access token через Play Services.
 */
class TrafaretAuthService {
    static final String DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

    private static final String TOKEN_PREFIX = "oauth2:";

    interface TokenCallback {
        void onToken(String token);
        void onError(String message, boolean recoverable);
    }

    interface StateCallback {
        void onState(boolean signedIn);
    }

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final GoogleSignInClient signInClient;
    private volatile String lastError = null;
    private volatile StateCallback stateListener = null;

    TrafaretAuthService(Context context) {
        this.context = context.getApplicationContext();
        this.signInClient = GoogleSignIn.getClient(context, new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestScopes(new Scope(DRIVE_FILE_SCOPE))
                .build());
    }

    void setStateListener(StateCallback listener) {
        this.stateListener = listener;
    }

    String getLastError() {
        return lastError;
    }

    /** Фиксация ошибки извне (отмена входа, недоступность Play Services). */
    void setExternalError(String error) {
        this.lastError = error;
    }

    /** На Android конфигурация — это само приложение (подпись + package name). */
    boolean isConfigured() {
        return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS;
    }

    String getSessionState() {
        if (!isConfigured()) return "not-configured";
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(context);
        return account != null ? "active" : "signed-out";
    }

    Intent signInIntent() {
        lastError = null;
        return signInClient.getSignInIntent();
    }

    /** Вызывается из callback активити: достаёт аккаунт и проверяет выдачу токена. */
    void handleSignInResult(Intent data, TokenCallback callback) {
        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            if (account == null || account.getAccount() == null) {
                lastError = "Google не вернул аккаунт";
                callback.onError(lastError, false);
                notifyState(false);
                return;
            }
            fetchToken(account.getAccount(), new TokenCallback() {
                @Override
                public void onToken(String token) {
                    lastError = null;
                    notifyState(true);
                    callback.onToken(token);
                }

                @Override
                public void onError(String message, boolean recoverable) {
                    lastError = message;
                    notifyState(false);
                    callback.onError(message, recoverable);
                }
            });
        } catch (ApiException error) {
            lastError = error.getStatusCode() == 12501 ? "Вход отменён" : "Не удалось выполнить вход через Google (код " + error.getStatusCode() + ")";
            notifyState(false);
            callback.onError(lastError, false);
        }
    }

    /** Access token на фоновом потоке — сетевые вызовы в UI-потоке запрещены. */
    void getAccessToken(TokenCallback callback) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(context);
        if (account == null || account.getAccount() == null) {
            callback.onError("NOT_SIGNED_IN", false);
            return;
        }
        fetchToken(account.getAccount(), callback);
    }

    private void fetchToken(Account account, TokenCallback callback) {
        executor.execute(() -> {
            try {
                String token = GoogleAuthUtil.getToken(context, account, TOKEN_PREFIX + DRIVE_FILE_SCOPE);
                if (token == null || token.isEmpty()) {
                    lastError = "Google не выдал access token";
                    callback.onError(lastError, false);
                    return;
                }
                lastError = null;
                callback.onToken(token);
            } catch (UserRecoverableAuthException recoverable) {
                // Пользователю нужно подтвердить доступ (например, через системный экран).
                callback.onError("Требуется подтверждение доступа в системном экране Google", true);
            } catch (IOException network) {
                callback.onError("Нет сети — не удалось обновить токен Google", false);
            } catch (Exception error) {
                lastError = "Ошибка получения токена: " + error.getClass().getSimpleName();
                callback.onError(lastError, false);
            }
        });
    }

    void signOut(@NonNull Runnable done) {
        // Токен на диске не храним, кэш GoogleAuthUtil привязан к аккаунту —
        // после signOut аккаунта в приложении не остаётся.
        signInClient.signOut().addOnCompleteListener(task -> {
            notifyState(false);
            done.run();
        });
    }

    private void notifyState(boolean signedIn) {
        StateCallback listener = stateListener;
        if (listener != null) {
            listener.onState(signedIn);
        }
    }

    void shutdown() {
        executor.shutdown();
    }
}
