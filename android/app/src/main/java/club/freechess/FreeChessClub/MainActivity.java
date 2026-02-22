// Custom MainActivity.java for Capacitor Android builds. Allows service worker to work with Android WebView

package club.freechess.FreeChessClub;

import android.os.Bundle;
import android.os.Build;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

  if(Build.VERSION.SDK_INT >= 24 ){
      ServiceWorkerController swController = ServiceWorkerController.getInstance();

      swController.setServiceWorkerClient(new ServiceWorkerClient() {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
          return bridge.getLocalServer().shouldInterceptRequest(request);
        }
      });
    }
  }
}


