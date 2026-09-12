package com.dshremote.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.dshremote.app.data.DshApi
import com.dshremote.app.data.RelayClient
import com.dshremote.app.data.SessionItem
import com.dshremote.app.data.TokenStore
import com.dshremote.app.ui.components.BottomNavBar
import com.dshremote.app.ui.components.TopDestination
import com.dshremote.app.ui.screens.ChatScreen
import com.dshremote.app.ui.screens.LinkScreen
import com.dshremote.app.ui.screens.OverviewScreen
import com.dshremote.app.ui.screens.PairingScreen
import com.dshremote.app.ui.screens.SessionListScreen
import com.dshremote.app.ui.screens.SettingsScreen
import com.dshremote.app.ui.theme.AppTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AppTheme {
                Surface(Modifier.fillMaxSize()) {
                    AppNav()
                }
            }
        }
    }
}

private val TOP_ROUTES = setOf("fleet", "sessions", "chains")

@Composable
private fun AppNav() {
    val context = LocalContext.current
    val store = remember { TokenStore(context) }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    var api by remember { mutableStateOf<DshApi?>(null) }
    var relayUrl by remember { mutableStateOf("") }
    var deviceId by remember { mutableStateOf("") }
    var opened by remember { mutableStateOf<SessionItem?>(null) }

    val start = remember { if (store.load() != null) "bootstrap" else "pair" }

    Scaffold(
        bottomBar = {
            if (route in TOP_ROUTES) {
                BottomNavBar(currentRoute = route) { destination ->
                    if (destination.route != route) {
                        nav.navigate(destination.route) {
                            popUpTo("sessions") { inclusive = false }
                            launchSingleTop = true
                        }
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = start, modifier = Modifier.padding(padding)) {
            composable("pair") {
                PairingScreen(onPaired = { url, device, token ->
                    store.save(url, device, token)
                    relayUrl = url
                    deviceId = device
                    nav.navigate("bootstrap") { popUpTo("pair") { inclusive = true } }
                })
            }
            composable("bootstrap") {
                Bootstrap(
                    store = store,
                    onReady = { client, device ->
                        relayUrl = client.baseUrl
                        deviceId = device
                        api = DshApi(client.http, client.wsHttp, client.deviceBase(device))
                        nav.navigate("sessions") { popUpTo("bootstrap") { inclusive = true } }
                    },
                    onAuthFailed = {
                        store.clear()
                        nav.navigate("pair") { popUpTo("bootstrap") { inclusive = true } }
                    },
                )
            }
            composable("sessions") {
                val current = api ?: return@composable
                SessionListScreen(
                    api = current,
                    insecureHttp = relayUrl.startsWith("http://"),
                    onOpen = { opened = it; nav.navigate("chat") },
                    onSettings = { nav.navigate("settings") },
                )
            }
            composable("fleet") {
                val current = api
                if (current == null) {
                    LaunchedEffect(Unit) { nav.navigate("bootstrap") }
                } else {
                    OverviewScreen(
                        api = current,
                        relayUrl = relayUrl,
                        deviceId = deviceId,
                        onOpenSessions = {
                            nav.navigate("sessions") { launchSingleTop = true }
                        },
                        onSessionCreated = { opened = it; nav.navigate("chat") },
                    )
                }
            }
            composable("chains") {
                val current = api
                if (current == null) {
                    LaunchedEffect(Unit) { nav.navigate("bootstrap") }
                } else {
                    LinkScreen(api = current, relayUrl = relayUrl)
                }
            }
            composable("chat") {
                val current = api ?: return@composable
                val item = opened ?: return@composable
                ChatScreen(
                    api = current, item = item,
                    onBack = { nav.popBackStack() },
                )
            }
            composable("settings") {
                SettingsScreen(
                    relayUrl = relayUrl,
                    deviceId = deviceId,
                    onBack = { nav.popBackStack() },
                    onUnpair = {
                        store.clear(); api = null
                        nav.navigate("pair") { popUpTo("settings") { inclusive = true } }
                    },
                )
            }
        }
    }
}

/**
 * Cold-start gate: the cookie jar is fresh every process launch, so a stored
 * token must be exchanged for a cookie (claim) before the proxy surface works.
 * A rejected claim means revocation → back to pairing.
 */
@Composable
private fun Bootstrap(
    store: TokenStore,
    onReady: (RelayClient, String) -> Unit,
    onAuthFailed: () -> Unit,
) {
    LaunchedEffect(Unit) {
        val saved = store.load()
        if (saved == null) {
            onAuthFailed()
            return@LaunchedEffect
        }
        val (url, device, token) = saved
        try {
            val client = RelayClient(url)
            client.claim(device, token)
            onReady(client, device)
        } catch (t: Throwable) {
            onAuthFailed()
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
