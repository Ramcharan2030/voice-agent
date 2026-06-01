"""API routes for knowledge base operations."""

import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger

from api.db import db_client
from api.enums import PostHogEvent
from api.schemas.knowledge_base import (
    ChunkSearchRequestSchema,
    ChunkSearchResponseSchema,
    DocumentListResponseSchema,
    DocumentResponseSchema,
    DocumentUploadRequestSchema,
    DocumentUploadResponseSchema,
    ProcessDocumentRequestSchema,
)
from api.sdk_expose import sdk_expose
from api.services.auth.depends import get_user
from api.services.posthog_client import capture_event
from api.services.storage import storage_fs
from api.tasks.arq import enqueue_job
from api.tasks.function_names import FunctionNames

router = APIRouter(prefix="/knowledge-base", tags=["knowledge-base"])

MAX_KNOWLEDGE_BASE_UPLOAD_BYTES = 25 * 1024 * 1024


@router.post(
    "/upload-url",
    response_model=DocumentUploadResponseSchema,
    summary="Get presigned URL for document upload",
)
async def get_upload_url(
    request: DocumentUploadRequestSchema,
    user=Depends(get_user),
):
    """Generate a presigned PUT URL for uploading a document.

    This endpoint:
    1. Generates a unique document UUID for organizing the S3 key
    2. Generates a presigned S3/MinIO URL for uploading the file
    3. Returns the upload URL and document metadata

    After uploading to the returned URL, call /process-document to create
    the document record and trigger processing.

    Access Control:
    * All authenticated users can upload documents scoped to their organization.
    """

    try:
        # Generate unique document UUID for S3 organization
        document_uuid = str(uuid.uuid4())

        # Generate S3 key: knowledge_base/{org_id}/{document_uuid}/{filename}
        s3_key = f"knowledge_base/{user.selected_organization_id}/{document_uuid}/{request.filename}"

        # Generate presigned PUT URL (valid for 30 minutes)
        upload_url = await storage_fs.aget_presigned_put_url(
            file_path=s3_key,
            expiration=1800,  # 30 minutes
            content_type=request.mime_type,
            max_size=MAX_KNOWLEDGE_BASE_UPLOAD_BYTES,
        )

        if not upload_url:
            raise HTTPException(
                status_code=500, detail="Failed to generate presigned upload URL"
            )

        logger.info(
            f"Generated upload URL for document {document_uuid}, "
            f"user {user.id}, org {user.selected_organization_id}"
        )

        return DocumentUploadResponseSchema(
            upload_url=upload_url,
            document_uuid=document_uuid,
            s3_key=s3_key,
        )

    except Exception as exc:
        logger.error(f"Error generating upload URL: {exc}")
        raise HTTPException(
            status_code=500, detail="Failed to generate upload URL"
        ) from exc


@router.post(
    "/process-document",
    response_model=DocumentResponseSchema,
    summary="Trigger document processing",
)
async def process_document(
    request: ProcessDocumentRequestSchema,
    user=Depends(get_user),
):
    """Trigger asynchronous processing of an uploaded document.

    This endpoint should be called after successfully uploading a file to the presigned URL.
    It will:
    1. Create a document record in the database with the specified UUID
    2. Enqueue a background task to process the document (chunking and embedding)

    The document status will be updated from 'pending' -> 'processing' -> 'completed' or 'failed'.

    Embedding:
    Uses configured 1536-dimensional embeddings. If no embedding provider is
    configured and the workflow uses Google realtime, the Google API key is reused
    with Gemini embeddings.

    Access Control:
    * Users can only process documents in their organization.
    """

    try:
        # Extract filename from s3_key
        filename = request.s3_key.split("/")[-1]

        # Create document record with the specific UUID from upload
        document = await db_client.create_document(
            organization_id=user.selected_organization_id,
            created_by=user.id,
            filename=filename,
            file_size_bytes=0,  # Will be updated by background task
            file_hash="",  # Will be computed by background task
            mime_type="application/octet-stream",  # Will be detected by background task
            custom_metadata={"s3_key": request.s3_key},
            document_uuid=request.document_uuid,  # Use UUID from upload
            retrieval_mode=request.retrieval_mode,
        )

        # Enqueue background task for processing
        await enqueue_job(
            FunctionNames.PROCESS_KNOWLEDGE_BASE_DOCUMENT,
            document.id,
            request.s3_key,
            user.selected_organization_id,
            str(user.provider_id),
            480,  # max_tokens-ish chunk budget for low-latency voice RAG
            request.retrieval_mode,
        )

        logger.info(
            f"Created document {request.document_uuid} (id={document.id}) and enqueued "
            f"local processing, org {user.selected_organization_id}"
        )

        capture_event(
            distinct_id=str(user.provider_id),
            event=PostHogEvent.KNOWLEDGE_BASE_CREATED,
            properties={
                "document_id": document.id,
                "document_uuid": str(request.document_uuid),
                "filename": filename,
                "retrieval_mode": request.retrieval_mode,
                "organization_id": user.selected_organization_id,
            },
        )

        return DocumentResponseSchema(
            id=document.id,
            document_uuid=request.document_uuid,
            filename=filename,
            file_size_bytes=0,
            file_hash="",
            mime_type="application/octet-stream",
            processing_status="pending",
            processing_error=None,
            total_chunks=0,
            retrieval_mode=request.retrieval_mode,
            custom_metadata={"s3_key": request.s3_key},
            docling_metadata={},
            source_url=None,
            created_at=document.created_at,
            updated_at=document.updated_at,
            organization_id=user.selected_organization_id,
            created_by=user.id,
            is_active=True,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error processing document: {exc}")
        raise HTTPException(
            status_code=500, detail="Failed to process document"
        ) from exc


@router.get(
    "/documents",
    response_model=DocumentListResponseSchema,
    summary="List documents",
    **sdk_expose(
        method="list_documents",
        description="List knowledge base documents available to the authenticated organization.",
    ),
)
async def list_documents(
    status: Annotated[
        Optional[str],
        Query(description="Filter by processing status"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    user=Depends(get_user),
):
    """List all documents for the user's organization.

    Access Control:
    * Users can only see documents from their organization.
    """

    try:
        documents = await db_client.get_documents_for_organization(
            organization_id=user.selected_organization_id,
            processing_status=status,
            limit=limit,
            offset=offset,
        )

        # Convert to response schema
        document_list = [
            DocumentResponseSchema(
                id=doc.id,
                document_uuid=doc.document_uuid,
                filename=doc.filename,
                file_size_bytes=doc.file_size_bytes,
                file_hash=doc.file_hash,
                mime_type=doc.mime_type,
                processing_status=doc.processing_status,
                processing_error=doc.processing_error,
                total_chunks=doc.total_chunks,
                retrieval_mode=doc.retrieval_mode,
                custom_metadata=doc.custom_metadata,
                docling_metadata=doc.docling_metadata,
                source_url=doc.source_url,
                created_at=doc.created_at,
                updated_at=doc.updated_at,
                organization_id=doc.organization_id,
                created_by=doc.created_by,
                is_active=doc.is_active,
            )
            for doc in documents
        ]

        return DocumentListResponseSchema(
            documents=document_list,
            total=len(document_list),
            limit=limit,
            offset=offset,
        )

    except Exception as exc:
        logger.error(f"Error listing documents: {exc}")
        raise HTTPException(status_code=500, detail="Failed to list documents") from exc


@router.get(
    "/documents/{document_uuid}",
    response_model=DocumentResponseSchema,
    summary="Get document details",
)
async def get_document(
    document_uuid: str,
    user=Depends(get_user),
):
    """Get details of a specific document.

    Access Control:
    * Users can only access documents from their organization.
    """

    try:
        document = await db_client.get_document_by_uuid(
            document_uuid=document_uuid,
            organization_id=user.selected_organization_id,
        )

        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        return DocumentResponseSchema(
            id=document.id,
            document_uuid=document.document_uuid,
            filename=document.filename,
            file_size_bytes=document.file_size_bytes,
            file_hash=document.file_hash,
            mime_type=document.mime_type,
            processing_status=document.processing_status,
            processing_error=document.processing_error,
            total_chunks=document.total_chunks,
            retrieval_mode=document.retrieval_mode,
            custom_metadata=document.custom_metadata,
            docling_metadata=document.docling_metadata,
            source_url=document.source_url,
            created_at=document.created_at,
            updated_at=document.updated_at,
            organization_id=document.organization_id,
            created_by=document.created_by,
            is_active=document.is_active,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error getting document: {exc}")
        raise HTTPException(status_code=500, detail="Failed to get document") from exc


@router.post(
    "/documents/{document_uuid}/retry",
    response_model=DocumentResponseSchema,
    summary="Retry document processing",
)
async def retry_document_processing(
    document_uuid: str,
    user=Depends(get_user),
):
    """Reset and re-enqueue processing for a pending, processing, or failed document.

    Access Control:
    * Users can only retry documents in their organization.
    """

    try:
        document = await db_client.get_document_by_uuid(
            document_uuid=document_uuid,
            organization_id=user.selected_organization_id,
        )

        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        if document.processing_status == "completed":
            raise HTTPException(
                status_code=400,
                detail="Document is already completed and cannot be retried",
            )

        s3_key = (document.custom_metadata or {}).get("s3_key")
        if not isinstance(s3_key, str) or not s3_key:
            raise HTTPException(
                status_code=400,
                detail="Document cannot be retried because its storage key is missing",
            )

        retry_document = await db_client.reset_document_for_processing(document.id)
        if not retry_document:
            raise HTTPException(status_code=404, detail="Document not found")

        created_by_provider_id = (
            document.created_by_user.provider_id
            if document.created_by_user
            else str(user.provider_id)
        )
        retrieval_mode = retry_document.retrieval_mode or "chunked"
        await enqueue_job(
            FunctionNames.PROCESS_KNOWLEDGE_BASE_DOCUMENT,
            retry_document.id,
            s3_key,
            retry_document.organization_id,
            created_by_provider_id,
            480,
            retrieval_mode,
        )

        logger.info(
            f"Retried document processing for {document_uuid} "
            f"(id={retry_document.id}), org {user.selected_organization_id}"
        )

        return DocumentResponseSchema(
            id=retry_document.id,
            document_uuid=retry_document.document_uuid,
            filename=retry_document.filename,
            file_size_bytes=retry_document.file_size_bytes or 0,
            file_hash=retry_document.file_hash or "",
            mime_type=retry_document.mime_type or "application/octet-stream",
            processing_status=retry_document.processing_status,
            processing_error=retry_document.processing_error,
            total_chunks=retry_document.total_chunks,
            retrieval_mode=retry_document.retrieval_mode,
            custom_metadata=retry_document.custom_metadata,
            docling_metadata=retry_document.docling_metadata,
            source_url=retry_document.source_url,
            created_at=retry_document.created_at,
            updated_at=retry_document.updated_at,
            organization_id=retry_document.organization_id,
            created_by=retry_document.created_by,
            is_active=retry_document.is_active,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error retrying document processing: {exc}")
        raise HTTPException(
            status_code=500, detail="Failed to retry document processing"
        ) from exc


@router.delete(
    "/documents/{document_uuid}",
    summary="Delete document",
)
async def delete_document(
    document_uuid: str,
    user=Depends(get_user),
):
    """Soft delete a document and its chunks.

    Access Control:
    * Users can only delete documents from their organization.
    """

    try:
        success = await db_client.delete_document(
            document_uuid=document_uuid,
            organization_id=user.selected_organization_id,
        )

        if not success:
            raise HTTPException(status_code=404, detail="Document not found")

        logger.info(
            f"Deleted document {document_uuid}, "
            f"user {user.id}, org {user.selected_organization_id}"
        )

        return {"success": True, "message": "Document deleted successfully"}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error deleting document: {exc}")
        raise HTTPException(
            status_code=500, detail="Failed to delete document"
        ) from exc


@router.post(
    "/search",
    response_model=ChunkSearchResponseSchema,
    summary="Search for similar chunks",
)
async def search_chunks(
    request: ChunkSearchRequestSchema,
    user=Depends(get_user),
):
    """Search for document chunks similar to the query.

    This endpoint uses vector similarity search to find relevant chunks.
    Results are returned without threshold filtering - apply similarity
    thresholds at the application layer after optional reranking.

    Access Control:
    * Users can only search documents from their organization.
    """

    try:
        # Import here to avoid circular dependency
        from api.services.gen_ai import (
            create_embedding_service,
            resolve_embedding_settings,
        )

        user_config = await db_client.get_user_configurations(user.id)
        embedding_settings = resolve_embedding_settings(user_config)
        embedding_service = create_embedding_service(
            db_client=db_client,
            provider=embedding_settings.get("provider"),
            api_key=embedding_settings.get("api_key"),
            model=embedding_settings.get("model"),
            base_url=embedding_settings.get("base_url"),
        )

        # Perform search
        results = await embedding_service.search_similar_chunks(
            query=request.query,
            organization_id=user.selected_organization_id,
            limit=request.limit,
            document_uuids=request.document_uuids,
        )

        # Apply similarity threshold if provided
        if request.min_similarity is not None:
            results = [r for r in results if r["similarity"] >= request.min_similarity]

        # Convert to response schema
        from api.schemas.knowledge_base import ChunkResponseSchema

        chunks = [
            ChunkResponseSchema(
                id=r["id"],
                document_id=r["document_id"],
                chunk_text=r["chunk_text"],
                contextualized_text=r.get("contextualized_text"),
                chunk_index=r["chunk_index"],
                chunk_metadata=r["chunk_metadata"],
                filename=r["filename"],
                document_uuid=r["document_uuid"],
                similarity=r["similarity"],
            )
            for r in results
        ]

        return ChunkSearchResponseSchema(
            chunks=chunks,
            query=request.query,
            total_results=len(chunks),
        )

    except Exception as exc:
        logger.error(f"Error searching chunks: {exc}")
        raise HTTPException(status_code=500, detail="Failed to search chunks") from exc
