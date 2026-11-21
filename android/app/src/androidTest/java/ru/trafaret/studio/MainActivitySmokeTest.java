package ru.trafaret.studio;

import static org.junit.Assert.*;

import android.os.Build;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MainActivitySmokeTest {
    private static final String PROBE = "const c=document.querySelector('canvas[aria-label=\"Поле плотности\"]');"
            + "const button=t=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===t && !b.matches(':disabled'));"
            + "const pixels=()=>new Uint32Array(c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer);"
            + "const same=(a,b)=>a.length===b.length && a.every((p,i)=>p===b[i]);";

    @Test
    public void mainStudioStrokeUndoRedo() throws Exception {
        org.junit.Assume.assumeTrue("Requires an explicitly disposable Android emulator",
                (Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"))
                && "true".equals(InstrumentationRegistry.getArguments().getString("disposableAvd")));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, "local HTML and enabled studio button", "return document.readyState==='complete' && "
                    + "document.contentType==='text/html' && !!document.querySelector('#root') && !!button('Основная студия · открыть 2048×2048');");
            eval(scenario, "button('Основная студия · открыть 2048×2048').click();");
            await(scenario, "2048 editor ready", "return c?.width===2048 && c.height===2048 && !!button('Открыть 384×240');");
            eval(scenario, "c.scrollIntoView({block:'center',inline:'center'}); window.__smokeBefore=pixels();");
            JSONArray point = new JSONArray(eval(scenario, "const r=c.getBoundingClientRect(), x=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,"
                    + "y=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;"
                    + "return document.elementFromPoint(x,y)===c && document.elementFromPoint(x+12,y)===c ? [x/innerWidth,y/innerWidth,12/innerWidth] : [];"));
            assertEquals("Canvas stroke path not exposed in WebView", 3, point.length());
            float x=(float)point.getDouble(0), y=(float)point.getDouble(1), dx=(float)point.getDouble(2);
            long start=SystemClock.uptimeMillis();
            for (int action : new int[]{MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP}) {
                scenario.onActivity(activity -> {
                    WebView web=findWebView(activity.findViewById(android.R.id.content));
                    MotionEvent e=MotionEvent.obtain(start,SystemClock.uptimeMillis(),action,
                            (x+(action==MotionEvent.ACTION_DOWN?0:dx))*web.getWidth(), y*web.getWidth(),0);
                    e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                    try { assertTrue(web.dispatchTouchEvent(e)); } finally { e.recycle(); }
                });
                SystemClock.sleep(40);
            }
            await(scenario,"committed stroke changed pixels", "if(!button('Шаг назад')) return false;"
                    + "window.__smokeAfter=pixels(); return !same(window.__smokeBefore,window.__smokeAfter);");
            eval(scenario,"button('Шаг назад').click();");
            await(scenario,"Undo restored initial RGBA", "return !!button('Шаг вперёд') && same(pixels(),window.__smokeBefore);");
            eval(scenario,"button('Шаг вперёд').click();");
            await(scenario,"Redo restored stroke RGBA", "return !!button('Шаг назад') && same(pixels(),window.__smokeAfter);");
        }
    }

    private static void await(ActivityScenario<MainActivity> scenario,String stage,String probe) throws Exception {
        long end=SystemClock.elapsedRealtime()+45_000;
        do {
            if ("true".equals(eval(scenario,probe))) return;
            SystemClock.sleep(200);
        } while (SystemClock.elapsedRealtime()<end);
        fail("Timeout: " + stage);
    }

    private static String eval(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        ArrayBlockingQueue<String> result=new ArrayBlockingQueue<>(1);
        scenario.onActivity(activity -> {
            assertFalse(activity.isFinishing() || activity.isDestroyed());
            assertNotNull(activity.getWindow());
            View root=activity.getWindow().findViewById(android.R.id.content);
            assertNotNull(root);
            assertTrue(root.isAttachedToWindow());
            WebView web=findWebView(root);
            if (web==null || !web.isAttachedToWindow()) result.offer("null");
            else web.evaluateJavascript("(()=>{if(location.origin!=='https://localhost')return false;"+PROBE+script+"})()",result::offer);
        });
        String value=result.poll(15,TimeUnit.SECONDS);
        assertNotNull("WebView probe did not return",value);
        return value;
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group=(ViewGroup)view;
            for(int i=0;i<group.getChildCount();i++) {
                WebView web=findWebView(group.getChildAt(i));
                if(web!=null)return web;
            }
        }
        return null;
    }
}
