# clean base image containing only comfyui, comfy-cli and comfyui-manager
FROM runpod/worker-comfyui:5.7.1-base

# copy models into comfyui
# build with: docker build --build-context models=/path/to/models -t flux-2 .
COPY --from=models mistral_3_small_flux2_bf16.safetensors /comfyui/models/text_encoders/mistral_3_small_flux2_bf16.safetensors
COPY --from=models Flux_2-Turbo-LoRA_comfyui.safetensors /comfyui/models/loras/Flux_2-Turbo-LoRA_comfyui.safetensors
COPY --from=models flux2_dev_fp8mixed.safetensors /comfyui/models/diffusion_models/flux2_dev_fp8mixed.safetensors
COPY --from=models flux2-vae.safetensors /comfyui/models/vae/flux2-vae.safetensors

# install custom nodes into comfyui
RUN git clone https://github.com/Acly/comfyui-tooling-nodes /comfyui/custom_nodes/comfyui-tooling-nodes && \
    pip install -r /comfyui/custom_nodes/comfyui-tooling-nodes/requirements.txt
# copy all input data (like images or videos) into comfyui (uncomment and adjust if needed)
# COPY input/ /comfyui/input/ 
