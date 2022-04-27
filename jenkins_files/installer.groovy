#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

properties([
    parameters(withRunConfig([
        string(name: "JENKINS_NODE_LABEL", defaultValue: "syc9-test-win", description: "Label for the jenkins node which the job will run on"),
        string(name: "C9_INTEGRATION_VERSION", defaultValue: "*", description: "The C9 integration version to bundle. Use '*' for the latest version."),
        string(name: "C9_TRADER_INSTALLER", description: "The C9 Trader installer to bundle. Provide a link to the MSI file."),
        string(name: "SDA_INSTALLER", description: "The standard Symphony Desktop Application installer to extract additional dependencies from. Provide a link to the MSI file."),
    ])),

    buildDiscarder(logRotator(artifactNumToKeepStr: '15', numToKeepStr: '15'))
])

abortPreviousRunningBuilds()

node(params.JENKINS_NODE_LABEL) {
    def artifactory = ArtifactoryServer "https://repo.symphony.com/artifactory", "jenkins-artifactory-credentials"

    cleanWs()
    checkout scm

    common = load("jenkins_files/common.groovy")

    try {
        common.withNvmVer {
            try {
                stage("Build SDA") {
                    bat """
                        call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
                        sed -i -e "s/\\"buildNumber\\"[[:space:]]*\\:[[:space:]]*\\".*\\"/\\"buildNumber\\":\\"%BUILD_NUMBER%\\"/g" package.json
                        call npm install
                        call npm run unpacked-win
                    """
                }
                stage("Fetch C9-SY-extension") {
                    artifactory.download(
                        name:   "services/c9-integration",
                        file:   "c9-integration-${params.C9_INTEGRATION_VERSION}.tgz",
                        target: "download/"
                    )
                }
                stage("Unpack C9-SY-extension") {
                    sh "tar -C download -xzvf download/c9-integration-*.tgz"
                }
                stage("Fetch C9 Trader installer") {
                    sh "curl -L '${params.C9_TRADER_INSTALLER}' -o download/C9Installer.msi"
                }
                stage("Extract C9 Trader") {
                    bat "msiexec /a download\\C9Installer.msi /qn TARGETDIR=\"${env.WORKSPACE}\\download\\C9Installer\""
                    bat "dir /s download\\C9Installer"
                }
                stage("Fetch base SDA installer") {
                    sh "curl -L '${params.SDA_INSTALLER}' -o download/SDAInstaller.msi"
                }
                stage("Extract base SDA") {
                    bat "msiexec /a download\\SDAInstaller.msi /qn TARGETDIR=\"${env.WORKSPACE}\\download\\SDAInstaller\""
                    bat "dir /s download\\SDAInstaller"
                }
                stage("Move SDA library folder into place") {
                    sh "mv download/SDAInstaller/ProgramFiles64Folder/Symphony/library ./"
                }
                stage("Move dependencies into place") {
                    sh "mkdir -p dist/win-unpacked/cloud9/integration dist/win-unpacked/cloud9/shell"
                    sh "mv download/c9-integration-*/extension.js dist/win-unpacked/cloud9/integration/"
                    sh "mv download/C9Installer/ProgramFilesPath/Cloud9\\ Technologies\\ LLC/C9Trader/* dist/win-unpacked/cloud9/shell/"
                    sh "rm -rf dist/win-unpacked/cloud9/shell/x86"
                    bat "del /s /q dist\\win-unpacked\\cloud9\\shell\\*.pdb"
                    bat "dir /s dist\\win-unpacked"
                }
                stage("Create installer") {
                    bat """
                        call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat"
                        call node -e "console.log(require('./package.json').version);" > version.txt
                        set /p baseVer=<version.txt
                        set SYMVER=%baseVer%
                        mkdir targets
                        set archiveName=Symphony-C9-Win64-%SYMVER%-%BUILD_NUMBER%
                        cd installer\\win
                        call BuildWixSharpInstaller.bat
                        copy "WixSharpInstaller\\Symphony.msi" "..\\..\\targets\\%archiveName%.msi"
                    """
                }
                stage("Publish installer artifact") {
                    archiveArtifacts artifacts: 'targets/*', fingerprint: false
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
