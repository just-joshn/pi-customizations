Node runs your code one piece at a time, in a loop. Each time around, it checks for things that are due: timers that have gone off, finished file or network work, and tasks you asked to run "right after this".

Small follow-up steps from promises (what happens after an `await` finishes) get priority. As soon as the current piece of code ends, Node runs all of those before it moves on to anything else. The catch: if those follow-ups keep creating more follow-ups, everything else gets stuck waiting.

Some slow jobs, like reading files or heavy math, can't be done without making Node wait. So Node hands them to a small team of helper workers (four by default). When a helper finishes, it tells the main loop, and the loop runs your code that was waiting on the result. If you were using `await`, your code picks up right there, ahead of anything else queued.

Network connections don't need the helpers. The operating system tells Node when they're ready.
