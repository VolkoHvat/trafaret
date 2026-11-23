package ru.trafaret.studio;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TrafaretFeedback")
public class TrafaretFeedbackPlugin extends Plugin {
    private static final Uri FORM = Uri.parse("https://github.com/VolkoHvat/trafaret/issues/new?template=beta-feedback.yml");

    @PluginMethod
    public void openForm(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, FORM).addCategory(Intent.CATEGORY_BROWSABLE));
            call.resolve();
        } catch (ActivityNotFoundException | SecurityException e) {
            call.reject("Не удалось открыть форму GitHub");
        }
    }
}
