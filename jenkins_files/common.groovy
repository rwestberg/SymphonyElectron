#!/usr/bin/env groovy

def withNvmVer(Closure body) {
    withNvm("v16.16.0 64", "npmrcFile") {\
        body()
    }
}

return this
