#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

properties([
    parameters(withRunConfig([
        string(name: "JENKINS_NODE_LABEL", defaultValue: "fe-test-win", description: "Label for the jenkins node which the job will run on")
    ])),

    buildDiscarder(logRotator(artifactNumToKeepStr: '15', numToKeepStr: '15'))
])

abortPreviousRunningBuilds()

notifyPRStatus("tests/unit") {
    node(params.JENKINS_NODE_LABEL) {
        cleanWs()
        checkout scm

        common = load("jenkins_files/common.groovy")

        try {
            common.withNvmVer {
                try {
                    stage("Install") {
                        sh "npm install"
                    }
                    stage("Build") {
                        sh "npm run prebuild"
                    }
                    stage("Unit Test") {
                        sh "npm run test:unit"
                    }
                } finally {
                    stage("Post Actions") {
                    }
                }
            }
        } finally {
            cleanWs()
        }
    }
}
