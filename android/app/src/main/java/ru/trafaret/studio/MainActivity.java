package ru.trafaret.studio;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Локальный плагин входа Google → контракт window.trafaretNative.auth.
        registerPlugin(TrafaretAuthPlugin.class);
    }
}
