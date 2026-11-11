package com.example.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            var count by rememberSaveable { mutableStateOf(0) }
            Column {
                Text("Home")
                Button(onClick = { count++ }) { Text("Count: $count") }
                Button(onClick = {
                    startActivity(Intent(this@MainActivity, DetailActivity::class.java).putExtra(DetailActivity.EXTRA_ID, 42))
                }) { Text("Open details") }
                Button(onClick = {
                    startActivity(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Hello"))
                }) { Text("Share") }
            }
        }
    }
}
