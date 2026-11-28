# Your own virtual machine (Windows)

A ready-to-run Ubuntu 24.04 server VM for running code and servers, created with
[Multipass](https://canonical.com/multipass). On first boot it installs git, build tools,
Python 3, Node.js LTS and Docker, and turns on a firewall (SSH, 3000 and 8000 open).

| File | What it does |
|------|--------------|
| `create-vm.ps1` | Installs Multipass (plus VirtualBox on Windows Home) and launches the VM |
| `cloud-init.yaml` | First-boot setup inside the VM. Edit it to add packages |

## Create it

1. Open **PowerShell as administrator** (Start, type PowerShell, right-click it, then *Run as administrator*).
2. Go to this folder and run the script:

   ```powershell
   cd path\to\Claude-AI-skills\vm
   powershell -ExecutionPolicy Bypass -File .\create-vm.ps1
   ```

   - On Windows Pro, the first run may switch on Hyper-V and ask you to restart. Run it again after the restart.
   - Bigger VM: `.\create-vm.ps1 -Name devbox -Cpus 4 -Memory 8G -Disk 60G`

3. Check it worked:

   ```powershell
   multipass shell devbox
   ```
   Then, inside the VM:
   ```bash
   cloud-init status --wait
   node -v
   python3 --version
   docker run hello-world
   ```

## Everyday commands (PowerShell)

| Task | Command |
|------|---------|
| Open a terminal in the VM | `multipass shell devbox` |
| List VMs and their IPs | `multipass list` |
| Stop / start | `multipass stop devbox` / `multipass start devbox` |
| Run one command | `multipass exec devbox -- uname -a` |
| Copy a file in | `multipass transfer .\app.zip devbox:/home/ubuntu/` |
| Snapshot (VM must be stopped) | `multipass snapshot devbox` |
| Restore a snapshot | `multipass restore devbox.snapshot1` |
| Delete for good | `multipass delete devbox; multipass purge` |

**Shared folder:** `%USERPROFILE%\vm-share` on Windows is `/home/ubuntu/share` in the VM.

## Reaching servers in the VM

**Windows Pro (Hyper-V):** start a server inside the VM, e.g. `python3 -m http.server 8000`.
Run `multipass list` to get the VM's IPv4, then open `http://<that IP>:8000` in your browser.

**Windows Home (VirtualBox):** the VM's IP isn't reachable from Windows, so forward a port.
Get [PsExec](https://learn.microsoft.com/sysinternals/downloads/psexec) and run this in an admin PowerShell:

```powershell
PsExec64.exe -s "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" controlvm devbox natpf1 "web3000,tcp,,3000,,3000"
```

Then open `http://localhost:3000`. Repeat the command with a different name and port for each port you need.

## Using VS Code

1. Install the **Remote - SSH** extension.
2. Copy your public key into the VM:
   ```powershell
   type $env:USERPROFILE\.ssh\id_ed25519.pub | multipass exec devbox -- tee -a /home/ubuntu/.ssh/authorized_keys
   ```
   No key yet? Create one first with `ssh-keygen -t ed25519`.
3. Connect to `ubuntu@<VM IP>` (Hyper-V). On VirtualBox, forward port 22 to, say, 2222 as shown above, then connect to `ubuntu@localhost -p 2222`.

## Troubleshooting

- **"Virtualization is OFF":** restart into BIOS/UEFI and enable Intel VT-x, or AMD-V (often called SVM Mode).
- **Launch times out:** the first boot downloads packages. Run `multipass list`. If the VM shows *Running*, just `multipass shell devbox` and check `cloud-init status`.
- **`multipass` not recognised:** close and reopen PowerShell so it picks up the new PATH.
- **Mount fails:** run `multipass set local.privileged-mounts=true`, then run the script again.
- **Start over:** `multipass delete devbox; multipass purge`, then run the script again.
